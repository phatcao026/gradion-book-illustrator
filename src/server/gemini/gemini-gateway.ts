import { GoogleGenAI, type Interactions } from '@google/genai';

import { PIPELINE_LIMITS } from '../pipeline-policy.js';
import {
  BOOK_CONTEXT_PROMPT,
  CHARACTERS_PROMPT,
  GENERATED_STYLE_PROMPT,
  chaptersPrompt,
  userStylePrompt,
} from './prompts.js';

const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
export const GEMINI_AUTOMATIC_RETRIES = 0;

export interface UploadedGeminiFile {
  name: string;
  uri: string;
  expiresAt: string | null;
}

export interface GeminiInteractionOutput {
  id: string;
  text: string;
}

export interface GeminiGateway {
  readonly model: string;
  uploadBook(bookText: string, displayName: string): Promise<UploadedGeminiFile>;
  createBookInteraction(fileUri: string): Promise<GeminiInteractionOutput>;
  createStyleInteraction(
    previousInteractionId: string,
    styleInput: string,
  ): Promise<GeminiInteractionOutput>;
  createCharactersInteraction(
    previousInteractionId: string,
  ): Promise<GeminiInteractionOutput>;
  createChaptersInteraction(
    previousInteractionId: string,
    characters: Array<{ name: string; prompt: string }>,
  ): Promise<GeminiInteractionOutput>;
}

export class GeminiGatewayError extends Error {
  constructor(
    readonly code:
      | 'GEMINI_NOT_CONFIGURED'
      | 'GEMINI_CONTEXT_EXPIRED'
      | 'GEMINI_INVALID_RESPONSE'
      | 'GEMINI_REQUEST_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface GoogleGeminiGatewayOptions {
  apiKey: string;
  model: string;
  serviceTier: 'standard';
}

export class GoogleGeminiGateway implements GeminiGateway {
  readonly model: string;
  private readonly client: Pick<GoogleGenAI, 'files' | 'interactions'>;
  private readonly serviceTier: 'standard';

  constructor(
    options: GoogleGeminiGatewayOptions,
    client?: Pick<GoogleGenAI, 'files' | 'interactions'>,
  ) {
    this.model = options.model;
    this.serviceTier = options.serviceTier;
    this.client =
      client ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: {
          timeout: REQUEST_TIMEOUT_MS,
          retryOptions: { attempts: GEMINI_AUTOMATIC_RETRIES },
        },
      });
  }

  async uploadBook(
    bookText: string,
    displayName: string,
  ): Promise<UploadedGeminiFile> {
    try {
      const file = await this.client.files.upload({
        file: new Blob([bookText], { type: 'text/plain' }),
        config: {
          displayName,
          mimeType: 'text/plain',
        },
      });

      if (!file.name || !file.uri) {
        throw new GeminiGatewayError(
          'GEMINI_INVALID_RESPONSE',
          'Gemini uploaded the book without returning a reusable file reference.',
        );
      }

      return {
        name: file.name,
        uri: file.uri,
        expiresAt: file.expirationTime ?? null,
      };
    } catch (error) {
      throw normalizeGeminiError(error, 'The book could not be uploaded to Gemini.');
    }
  }

  async createBookInteraction(fileUri: string): Promise<GeminiInteractionOutput> {
    return this.createInteraction({
      input: [
        { type: 'text', text: BOOK_CONTEXT_PROMPT },
        { type: 'document', uri: fileUri },
      ],
    });
  }

  async createStyleInteraction(
    previousInteractionId: string,
    styleInput: string,
  ): Promise<GeminiInteractionOutput> {
    return this.createInteraction({
      input:
        styleInput.length > 0
          ? userStylePrompt(styleInput)
          : GENERATED_STYLE_PROMPT,
      previous_interaction_id: previousInteractionId,
    });
  }

  async createCharactersInteraction(
    previousInteractionId: string,
  ): Promise<GeminiInteractionOutput> {
    return this.createInteraction({
      input: CHARACTERS_PROMPT,
      previous_interaction_id: previousInteractionId,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'array',
          maxItems: PIPELINE_LIMITS.maxAdultCharacters,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: {
                type: 'string',
                description: 'The adult character name.',
              },
              prompt: {
                type: 'string',
                description:
                  'A detailed portrait prompt grounded in the book description.',
              },
            },
            required: ['name', 'prompt'],
          },
        },
      },
    });
  }

  async createChaptersInteraction(
    previousInteractionId: string,
    characters: Array<{ name: string; prompt: string }>,
  ): Promise<GeminiInteractionOutput> {
    return this.createInteraction({
      input: chaptersPrompt(characters),
      previous_interaction_id: previousInteractionId,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'array',
          minItems: 1,
          maxItems: PIPELINE_LIMITS.maxChapters,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: {
                type: 'string',
                description: 'A concise name for the selected scene.',
              },
              prompt: {
                type: 'string',
                description:
                  'A detailed single-image chapter scene prompt grounded in the book.',
              },
            },
            required: ['name', 'prompt'],
          },
        },
      },
    });
  }

  private async createInteraction(input: {
    input: Interactions.CreateModelInteractionParamsNonStreaming['input'];
    previous_interaction_id?: string;
    response_format?: Interactions.CreateModelInteractionParamsNonStreaming['response_format'];
  }): Promise<GeminiInteractionOutput> {
    try {
      const interaction = await this.client.interactions.create(
        {
          model: this.model,
          input: input.input,
          previous_interaction_id: input.previous_interaction_id,
          response_format: input.response_format,
          service_tier: this.serviceTier,
          store: true,
        },
        {
          maxRetries: GEMINI_AUTOMATIC_RETRIES,
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

      if (!interaction.id) {
        throw new GeminiGatewayError(
          'GEMINI_INVALID_RESPONSE',
          'Gemini completed a request without returning an interaction ID.',
        );
      }

      return {
        id: interaction.id,
        text: interaction.output_text ?? '',
      };
    } catch (error) {
      throw normalizeGeminiError(
        error,
        'Gemini could not complete the requested interaction.',
      );
    }
  }
}

export class UnconfiguredGeminiGateway implements GeminiGateway {
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  uploadBook(): Promise<UploadedGeminiFile> {
    return Promise.reject(notConfiguredError());
  }

  createBookInteraction(): Promise<GeminiInteractionOutput> {
    return Promise.reject(notConfiguredError());
  }

  createStyleInteraction(): Promise<GeminiInteractionOutput> {
    return Promise.reject(notConfiguredError());
  }

  createCharactersInteraction(): Promise<GeminiInteractionOutput> {
    return Promise.reject(notConfiguredError());
  }

  createChaptersInteraction(): Promise<GeminiInteractionOutput> {
    return Promise.reject(notConfiguredError());
  }
}

function notConfiguredError(): GeminiGatewayError {
  return new GeminiGatewayError(
    'GEMINI_NOT_CONFIGURED',
    'Gemini is not configured. Add GEMINI_API_KEY to the server environment and retry.',
  );
}

function normalizeGeminiError(error: unknown, fallback: string): GeminiGatewayError {
  if (error instanceof GeminiGatewayError) return error;

  const candidate = error as { status?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  const detail = typeof candidate?.message === 'string' ? candidate.message : '';
  const contextExpired =
    (status === 400 || status === 404) &&
    /(previous interaction|interaction|file).*(expired|not found|invalid)|expired.*(interaction|file)/i.test(
      detail,
    );

  if (contextExpired) {
    return new GeminiGatewayError(
      'GEMINI_CONTEXT_EXPIRED',
      'Gemini no longer has the stored book context. Retry to rebuild it from the local book.',
      { cause: error },
    );
  }

  return new GeminiGatewayError('GEMINI_REQUEST_FAILED', fallback, {
    cause: error,
  });
}
