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

const chapterSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(40).max(8_000),
  })
  .strict();

const chaptersSchema = z.array(chapterSchema).length(PIPELINE_LIMITS.maxChapters);

export interface PipelineAttempt {
  userId: string;
  projectId: string;
  step: PipelineStepNumber;
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
      } else if (attempt.step === 3) {
        await this.runPortraits(attempt, context);
      } else if (attempt.step === 4) {
        await this.runChapters(attempt, context);
      } else {
        await this.runIllustration(attempt, context);
      }
    } catch (error) {
      if (error instanceof AttemptLostError) return;

      const failure = normalizeRunnerError(error);
      if (failure.code === 'GEMINI_CONTEXT_EXPIRED') {
        if (attempt.step === 3 || attempt.step === 5) {
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
    const context = await this.ensureStyleContext(attempt, initialContext);

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

  private async runChapters(
    attempt: PipelineAttempt,
    initialContext: PipelineExecutionContext,
  ): Promise<void> {
    const context = await this.ensureStyleContext(attempt, initialContext);
    const characters = this.repository.listCharacterPrompts(
      attempt.userId,
      attempt.projectId,
    );
    const interaction = await this.gateway.createChaptersInteraction(
      context.charactersInteractionId ??
        required(context.styleInteractionId, 'style interaction'),
      characters,
    );
    const [chapter] = parseChapters(interaction.text);
    const applied = this.repository.completeChapters({
      ...this.withNow(attempt),
      interactionId: interaction.id,
      chapter,
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

  private async runIllustration(
    attempt: PipelineAttempt,
    context: PipelineExecutionContext,
  ): Promise<void> {
    const style = required(context.styleText, 'persisted style');
    const item = this.repository.getIllustrationWork(
      attempt.userId,
      attempt.projectId,
    );
    if (!item) {
      throw new GeminiGatewayError(
        'GEMINI_INVALID_RESPONSE',
        'The project is missing its persisted chapter illustration work.',
      );
    }
    if (item.status === 'COMPLETED') {
      const completion = this.pipelineState.completeAttempt(
        attempt.userId,
        attempt.projectId,
        attempt.attemptId,
      );
      if (!completion.applied) throw new AttemptLostError();
      return;
    }

    const portraits = this.repository
      .listPortraitWork(attempt.userId, attempt.projectId)
      .filter((portrait) => portrait.status === 'COMPLETED');
    const lastPortrait = portraits.at(-1);
    const mustRebuild =
      context.imageContextState === 'EXPIRED' ||
      (portraits.length > 0 && !lastPortrait?.interactionId);
    const previousInteractionId = mustRebuild
      ? null
      : (lastPortrait?.interactionId ?? null);
    const references = mustRebuild
      ? await this.readCompletedPortraits(portraits)
      : [];

    if (
      !this.repository.markIllustrationGenerating({
        ...this.withNow(attempt),
        chapterId: item.chapterId,
      })
    ) {
      throw new AttemptLostError();
    }

    let imagePath: string | null = null;
    let illustrationPersisted = false;
    try {
      const generated = await this.imageGateway.generateChapterIllustration({
        previousInteractionId,
        references,
        chapterName: item.name,
        chapterPrompt: item.prompt,
        style,
      });
      imagePath = await this.imageStorage.writeChapterIllustration({
        userId: attempt.userId,
        projectId: attempt.projectId,
        chapterId: item.chapterId,
        mimeType: generated.mimeType,
        bytes: generated.bytes,
      });
      const applied = this.repository.completeIllustration({
        ...this.withNow(attempt),
        chapterId: item.chapterId,
        imagePath,
        mimeType: generated.mimeType,
        interactionId: generated.interactionId,
      });
      if (!applied) {
        await this.imageStorage.removeImage(imagePath).catch(() => undefined);
        throw new AttemptLostError();
      }
      illustrationPersisted = true;
    } catch (error) {
      if (imagePath && !illustrationPersisted) {
        await this.imageStorage.removeImage(imagePath).catch(() => undefined);
      }
      if (error instanceof AttemptLostError) throw error;
      const failure = normalizeRunnerError(error);
      this.repository.failIllustration({
        ...this.withNow(attempt),
        chapterId: item.chapterId,
        error: failure,
      });
      throw error;
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

  private async ensureStyleContext(
    attempt: PipelineAttempt,
    initialContext: PipelineExecutionContext,
  ): Promise<PipelineExecutionContext> {
    let context = await this.ensureBookContext(attempt, initialContext);
    if (context.styleInteractionId) return context;

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

function parseChapters(value: string): [{ name: string; prompt: string }] {
  try {
    return chaptersSchema.parse(JSON.parse(value)) as [
      { name: string; prompt: string },
    ];
  } catch (error) {
    throw new GeminiGatewayError(
      'GEMINI_INVALID_RESPONSE',
      'Gemini returned an invalid chapter illustration prompt.',
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
