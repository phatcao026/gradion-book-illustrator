import { z } from 'zod';

import type { PipelineStepNumber, StyleSource } from '../shared/contracts.js';
import { BookStorage } from './book-storage.js';
import {
  GeminiGatewayError,
  type GeminiGateway,
} from './gemini/gemini-gateway.js';
import type { GeminiImageGateway, ImageReference } from './gemini/image-gateway.js';
import { ImageStorage } from './image-storage.js';
import {
  PipelineExecutionRepository,
  type PipelineExecutionContext,
} from './pipeline-execution-repository.js';
import { PIPELINE_LIMITS } from './pipeline-policy.js';
import { PipelineStateService } from './pipeline-state.js';

const generatedStyleSchema = z
  .string()
  .trim()
  .min(1, 'Gemini returned an empty style.')
  .max(10_000, 'Gemini returned a style that is too long.');

const characterSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(40).max(8_000),
  })
  .strict();

const charactersSchema = z
  .array(characterSchema)
  .max(PIPELINE_LIMITS.maxAdultCharacters)
  .superRefine((characters, context) => {
    const names = new Set<string>();
    characters.forEach((character, index) => {
      const normalized = character.name.toLocaleLowerCase();
      if (names.has(normalized)) {
        context.addIssue({
          code: 'custom',
          message: 'Gemini returned duplicate character names.',
          path: [index, 'name'],
        });
      }
      names.add(normalized);
    });
  });

export interface PipelineAttempt {
  userId: string;
  projectId: string;
  step: Extract<PipelineStepNumber, 1 | 2 | 3>;
  attemptId: string;
}

export class PipelineRunner {
  constructor(
    private readonly gateway: GeminiGateway,
    private readonly repository: PipelineExecutionRepository,
    private readonly pipelineState: PipelineStateService,
    private readonly bookStorage: BookStorage,
    private readonly imageGateway: GeminiImageGateway,
    private readonly imageStorage: ImageStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runAttempt(attempt: PipelineAttempt): Promise<void> {
    try {
      const context = this.requireCurrentAttempt(attempt);
      if (attempt.step === 1) {
        await this.runStyle(attempt, context);
      } else if (attempt.step === 2) {
        await this.runCharacters(attempt, context);
      } else {
        await this.runPortraits(attempt, context);
      }
    } catch (error) {
      if (error instanceof AttemptLostError) return;

      const failure = normalizeRunnerError(error);
      if (failure.code === 'GEMINI_CONTEXT_EXPIRED') {
        if (attempt.step === 3) {
          this.repository.markImageContextExpired(this.withNow(attempt));
        } else {
          this.repository.markContextExpired(this.withNow(attempt));
        }
      }
      this.pipelineState.failAttempt(
        attempt.userId,
        attempt.projectId,
        attempt.attemptId,
        failure,
      );
    }
  }

  private async runStyle(
    attempt: PipelineAttempt,
    initialContext: PipelineExecutionContext,
  ): Promise<void> {
    const context = await this.ensureBookContext(attempt, initialContext);
    const styleInteraction = await this.gateway.createStyleInteraction(
      required(context.bookInteractionId, 'book interaction'),
      context.styleInput,
    );
    const source: StyleSource = context.styleInput ? 'USER' : 'GENERATED';
    const styleText =
      source === 'USER'
        ? context.styleInput
        : parseGeneratedStyle(styleInteraction.text);

    const applied = this.repository.completeStyle({
      ...this.withNow(attempt),
      interactionId: styleInteraction.id,
      source,
      styleText,
    });
    if (!applied) throw new AttemptLostError();
  }

  private async runCharacters(
    attempt: PipelineAttempt,
    initialContext: PipelineExecutionContext,
  ): Promise<void> {
    let context = await this.ensureBookContext(attempt, initialContext);

    if (!context.styleInteractionId) {
      const styleText = required(context.styleText, 'persisted style');
      const rehydratedStyle = await this.gateway.createStyleInteraction(
        required(context.bookInteractionId, 'book interaction'),
        styleText,
      );
      const applied = this.repository.persistRehydratedStyleInteraction({
        ...this.withNow(attempt),
        interactionId: rehydratedStyle.id,
      });
      if (!applied) throw new AttemptLostError();
      context = this.requireCurrentAttempt(attempt);
    }

    const interaction = await this.gateway.createCharactersInteraction(
      required(context.styleInteractionId, 'style interaction'),
    );
    const characters = parseCharacters(interaction.text);
    const applied = this.repository.completeCharacters({
      ...this.withNow(attempt),
      interactionId: interaction.id,
      characters,
    });
    if (!applied) throw new AttemptLostError();
  }

  private async runPortraits(
    attempt: PipelineAttempt,
    context: PipelineExecutionContext,
  ): Promise<void> {
    const style = required(context.styleText, 'persisted style');
    const work = this.repository.listPortraitWork(attempt.userId, attempt.projectId);
    const completed = work.filter((item) => item.status === 'COMPLETED');
    const pending = work.filter((item) => item.status !== 'COMPLETED');

    if (pending.length === 0) {
      const completion = this.pipelineState.completeAttempt(
        attempt.userId,
        attempt.projectId,
        attempt.attemptId,
      );
      if (!completion.applied) throw new AttemptLostError();
      return;
    }

    const lastCompleted = completed.at(-1);
    const mustRebuild =
      context.imageContextState === 'EXPIRED' ||
      (completed.length > 0 && !lastCompleted?.interactionId);
    let previousInteractionId = mustRebuild
      ? null
      : (lastCompleted?.interactionId ?? null);
    let references = mustRebuild
      ? await this.readCompletedPortraits(completed)
      : [];

    for (const item of pending) {
      if (
        !this.repository.markPortraitGenerating({
          ...this.withNow(attempt),
          characterId: item.characterId,
        })
      ) {
        throw new AttemptLostError();
      }

      let imagePath: string | null = null;
      let portraitPersisted = false;
      try {
        const generated = await this.imageGateway.generatePortrait({
          previousInteractionId,
          references,
          characterName: item.name,
          characterPrompt: item.prompt,
          style,
        });
        imagePath = await this.imageStorage.writePortrait({
          userId: attempt.userId,
          projectId: attempt.projectId,
          characterId: item.characterId,
          mimeType: generated.mimeType,
          bytes: generated.bytes,
        });
        const applied = this.repository.completePortrait({
          ...this.withNow(attempt),
          characterId: item.characterId,
          imagePath,
          mimeType: generated.mimeType,
          interactionId: generated.interactionId,
        });
        if (!applied) {
          await this.imageStorage.removeImage(imagePath).catch(() => undefined);
          throw new AttemptLostError();
        }
        portraitPersisted = true;

        previousInteractionId = generated.interactionId;
        references = [];
      } catch (error) {
        if (imagePath && !portraitPersisted) {
          await this.imageStorage.removeImage(imagePath).catch(() => undefined);
        }
        if (error instanceof AttemptLostError) throw error;
        const failure = normalizeRunnerError(error);
        this.repository.failPortrait({
          ...this.withNow(attempt),
          characterId: item.characterId,
          error: failure,
        });
        throw error;
      }
    }

    const completion = this.pipelineState.completeAttempt(
      attempt.userId,
      attempt.projectId,
      attempt.attemptId,
    );
    if (!completion.applied) throw new AttemptLostError();
  }

  private async readCompletedPortraits(
    completed: ReturnType<PipelineExecutionRepository['listPortraitWork']>,
  ): Promise<ImageReference[]> {
    return Promise.all(
      completed.map(async (item) => ({
        bytes: await this.imageStorage.readImage(
          required(item.imagePath, 'completed portrait path'),
        ),
        mimeType: required(item.mimeType, 'completed portrait MIME type'),
      })),
    );
  }

  private async ensureBookContext(
    attempt: PipelineAttempt,
    initialContext: PipelineExecutionContext,
  ): Promise<PipelineExecutionContext> {
    let context = initialContext;

    if (context.contextState === 'EXPIRED') {
      const reset = this.repository.resetExpiredContext(this.withNow(attempt));
      if (!reset) throw new AttemptLostError();
      context = this.requireCurrentAttempt(attempt);
    }

    if (!context.geminiFileUri) {
      const bookText = await this.bookStorage.readBook(context.bookPath);
      const file = await this.gateway.uploadBook(
        bookText,
        `${context.title.slice(0, 480)}.txt`,
      );
      const applied = this.repository.persistUploadedFile({
        ...this.withNow(attempt),
        file,
      });
      if (!applied) throw new AttemptLostError();
      context = this.requireCurrentAttempt(attempt);
    }

    if (!context.bookInteractionId) {
      const interaction = await this.gateway.createBookInteraction(
        required(context.geminiFileUri, 'Gemini file URI'),
      );
      const applied = this.repository.persistBookInteraction({
        ...this.withNow(attempt),
        interactionId: interaction.id,
      });
      if (!applied) throw new AttemptLostError();
      context = this.requireCurrentAttempt(attempt);
    }

    return context;
  }

  private requireCurrentAttempt(
    attempt: PipelineAttempt,
  ): PipelineExecutionContext {
    const context = this.repository.getContext(
      attempt.userId,
      attempt.projectId,
    );
    if (
      !context ||
      context.runState !== 'RUNNING' ||
      context.activeStep !== attempt.step ||
      context.attemptId !== attempt.attemptId
    ) {
      throw new AttemptLostError();
    }
    return context;
  }

  private withNow(attempt: PipelineAttempt) {
    return { ...attempt, now: this.now().toISOString() };
  }
}

class AttemptLostError extends Error {}

function required<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new GeminiGatewayError(
      'GEMINI_INVALID_RESPONSE',
      `The project is missing its ${label}.`,
    );
  }
  return value;
}

function parseGeneratedStyle(value: string): string {
  try {
    return generatedStyleSchema.parse(value);
  } catch (error) {
    throw new GeminiGatewayError(
      'GEMINI_INVALID_RESPONSE',
      'Gemini returned an invalid generated style.',
      { cause: error },
    );
  }
}

function parseCharacters(value: string): Array<{ name: string; prompt: string }> {
  try {
    return charactersSchema.parse(JSON.parse(value));
  } catch (error) {
    throw new GeminiGatewayError(
      'GEMINI_INVALID_RESPONSE',
      'Gemini returned an invalid adult-character list.',
      { cause: error },
    );
  }
}

function normalizeRunnerError(error: unknown): { code: string; message: string } {
  if (error instanceof GeminiGatewayError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'PIPELINE_EXECUTION_FAILED',
    message: 'The pipeline step could not be completed.',
  };
}
