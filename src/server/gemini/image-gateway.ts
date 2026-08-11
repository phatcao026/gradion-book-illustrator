import { GoogleGenAI, type Interactions } from '@google/genai';

import type { StoredImageMimeType } from '../image-storage.js';
import {
  GEMINI_AUTOMATIC_RETRIES,
  GeminiGatewayError,
} from './gemini-gateway.js';
import { chapterIllustrationPrompt, portraitPrompt } from './prompts.js';

const IMAGE_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
export const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BASE64_CHARS =
  Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4;

export interface ImageReference {
  bytes: Buffer;
  mimeType: StoredImageMimeType;
}

export interface GeneratedGeminiImage {
  interactionId: string;
  bytes: Buffer;
  mimeType: StoredImageMimeType;
}

export interface PortraitGenerationInput {
  previousInteractionId: string | null;
  references: ImageReference[];
  characterName: string;
  characterPrompt: string;
  style: string;
}

export interface ChapterIllustrationGenerationInput {
  previousInteractionId: string | null;
  references: ImageReference[];
  chapterName: string;
  chapterPrompt: string;
  style: string;
}

export interface GeminiImageGateway {
  readonly model: string;
  generatePortrait(input: PortraitGenerationInput): Promise<GeneratedGeminiImage>;
  generateChapterIllustration(
    input: ChapterIllustrationGenerationInput,
  ): Promise<GeneratedGeminiImage>;
}

export interface GoogleGeminiImageGatewayOptions {
  apiKey: string;
  model: string;
  serviceTier: 'standard';
}

export class GoogleGeminiImageGateway implements GeminiImageGateway {
  readonly model: string;
  private readonly client: Pick<GoogleGenAI, 'interactions'>;
  private readonly serviceTier: 'standard';

  constructor(
    options: GoogleGeminiImageGatewayOptions,
    client?: Pick<GoogleGenAI, 'interactions'>,
  ) {
    this.model = options.model;
    this.serviceTier = options.serviceTier;
    this.client =
      client ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: {
          timeout: IMAGE_REQUEST_TIMEOUT_MS,
          retryOptions: { attempts: GEMINI_AUTOMATIC_RETRIES },
        },
      });
  }

  async generatePortrait(
    input: PortraitGenerationInput,
  ): Promise<GeneratedGeminiImage> {
    const prompt = portraitPrompt({
      characterName: input.characterName,
      characterPrompt: input.characterPrompt,
      style: input.style,
      hasReferencePortraits: input.references.length > 0,
    });
    return this.generateImage({
      previousInteractionId: input.previousInteractionId,
      references: input.references,
      prompt,
      aspectRatio: '9:16',
    });
  }

  async generateChapterIllustration(
    input: ChapterIllustrationGenerationInput,
  ): Promise<GeneratedGeminiImage> {
    const prompt = chapterIllustrationPrompt({
      chapterName: input.chapterName,
      chapterPrompt: input.chapterPrompt,
      style: input.style,
      hasReferencePortraits: input.references.length > 0,
    });
    return this.generateImage({
      previousInteractionId: input.previousInteractionId,
      references: input.references,
      prompt,
      aspectRatio: '16:9',
    });
  }

  private async generateImage(input: {
    previousInteractionId: string | null;
    references: ImageReference[];
    prompt: string;
    aspectRatio: '9:16' | '16:9';
  }): Promise<GeneratedGeminiImage> {
    const interactionInput: Interactions.CreateModelInteractionParamsNonStreaming['input'] =
      input.references.length === 0
        ? input.prompt
        : [
            { type: 'text', text: input.prompt },
            ...input.references.map((reference) => ({
              type: 'image' as const,
              data: reference.bytes.toString('base64'),
              mime_type: reference.mimeType,
            })),
          ];

    try {
      const interaction = await this.client.interactions.create(
        {
          model: this.model,
          input: interactionInput,
          previous_interaction_id: input.previousInteractionId ?? undefined,
          response_modalities: ['image'],
          response_format: {
            type: 'image',
            mime_type: 'image/jpeg',
            aspect_ratio: input.aspectRatio,
            image_size: '1K',
          },
          service_tier: this.serviceTier,
          store: true,
        },
        {
          maxRetries: GEMINI_AUTOMATIC_RETRIES,
          timeout: IMAGE_REQUEST_TIMEOUT_MS,
        },
      );

      if (!interaction.id || !interaction.output_image?.data) {
        throw new GeminiGatewayError(
          'GEMINI_INVALID_RESPONSE',
          'Gemini completed the image request without returning an image.',
        );
      }

      const mimeType = parseImageMimeType(interaction.output_image.mime_type);
      const bytes = decodeAndValidateImage(interaction.output_image.data, mimeType);
      return { interactionId: interaction.id, bytes, mimeType };
    } catch (error) {
      throw normalizeImageError(error);
    }
  }
}

export class UnconfiguredGeminiImageGateway implements GeminiImageGateway {
  constructor(readonly model: string) {}

  generatePortrait(): Promise<GeneratedGeminiImage> {
    return Promise.reject(
      new GeminiGatewayError(
        'GEMINI_NOT_CONFIGURED',
        'Gemini is not configured. Add GEMINI_API_KEY to the server environment and retry.',
      ),
    );
  }

  generateChapterIllustration(): Promise<GeneratedGeminiImage> {
    return Promise.reject(
      new GeminiGatewayError(
        'GEMINI_NOT_CONFIGURED',
        'Gemini is not configured. Add GEMINI_API_KEY to the server environment and retry.',
      ),
    );
  }
}

function parseImageMimeType(value: unknown): StoredImageMimeType {
  if (value === 'image/png' || value === 'image/jpeg') return value;
  throw new GeminiGatewayError(
    'GEMINI_INVALID_RESPONSE',
    'Gemini returned an unsupported portrait image type.',
  );
}

function decodeAndValidateImage(
  data: string,
  mimeType: StoredImageMimeType,
): Buffer {
  const normalized = data.replace(/\s/g, '');
  if (
    normalized.length === 0 ||
    normalized.length > MAX_GENERATED_IMAGE_BASE64_CHARS ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw invalidImageError();
  }

  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_GENERATED_IMAGE_BYTES) {
    throw invalidImageError();
  }

  const canonicalInput = normalized.replace(/=+$/, '');
  const canonicalDecoded = bytes.toString('base64').replace(/=+$/, '');
  if (canonicalInput !== canonicalDecoded || !matchesMimeSignature(bytes, mimeType)) {
    throw invalidImageError();
  }
  return bytes;
}

function matchesMimeSignature(bytes: Buffer, mimeType: StoredImageMimeType): boolean {
  if (mimeType === 'image/png') {
    return bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function invalidImageError(): GeminiGatewayError {
  return new GeminiGatewayError(
    'GEMINI_INVALID_RESPONSE',
    'Gemini returned invalid or oversized image data.',
  );
}

function normalizeImageError(error: unknown): GeminiGatewayError {
  if (error instanceof GeminiGatewayError) return error;
  const { status, providerStatus, detail, name } = readProviderError(error);
  const searchableDetail = `${providerStatus} ${detail}`;
  if (
    (status === 400 || status === 404) &&
    /(previous interaction|interaction).*(expired|not found|invalid)|expired.*interaction/i.test(
      searchableDetail,
    )
  ) {
    return new GeminiGatewayError(
      'GEMINI_CONTEXT_EXPIRED',
      'Gemini no longer has the stored image context. Retry to rebuild it from completed local portraits.',
      { cause: error },
    );
  }

  if (
    /billing|billed users?|paid tier|free[_ -]?tier.*(?:limit|quota).*0/i.test(
      searchableDetail,
    )
  ) {
    return imageRequestError(
      'Gemini image generation is not enabled for this API key project. Verify that the key belongs to the billed project and that its image quota is active in Google AI Studio.',
      error,
    );
  }
  if (status === 401) {
    return imageRequestError(
      'Gemini rejected the API key. Verify GEMINI_API_KEY and restart the server.',
      error,
    );
  }
  if (status === 403) {
    return imageRequestError(
      'This API key project does not have permission to use Gemini image generation. Check its billing project and API access.',
      error,
    );
  }
  if (status === 429 || /resource[_ -]?exhausted|quota|rate limit/i.test(searchableDetail)) {
    return imageRequestError(
      'Gemini image quota is unavailable or exhausted for this project. Check the model quota in Google AI Studio before retrying.',
      error,
    );
  }
  if (
    status === 408 ||
    /timeout/i.test(name) ||
    /timed? out|deadline exceeded/i.test(searchableDetail)
  ) {
    return imageRequestError(
      'The Gemini image request timed out. Check the network and retry this step once.',
      error,
    );
  }
  if (status === 400) {
    return imageRequestError(
      'Gemini rejected the image request as invalid. Check the configured image model and request support for this API key project.',
      error,
    );
  }
  if (status === 404) {
    return imageRequestError(
      'The configured Gemini image model or image endpoint was not found for this API key project.',
      error,
    );
  }
  if (status !== null && status >= 500) {
    return imageRequestError(
      'Gemini image generation is temporarily unavailable. Retry this step later.',
      error,
    );
  }
  return new GeminiGatewayError(
    'GEMINI_REQUEST_FAILED',
    'Gemini could not generate the requested image.',
    { cause: error },
  );
}

function imageRequestError(message: string, cause: unknown): GeminiGatewayError {
  return new GeminiGatewayError('GEMINI_REQUEST_FAILED', message, { cause });
}

function readProviderError(error: unknown): {
  status: number | null;
  providerStatus: string;
  detail: string;
  name: string;
} {
  const candidate = asRecord(error);
  const body = asRecord(candidate?.error);
  const nestedBody = asRecord(body?.error);
  return {
    status: firstNumber(
      candidate?.status,
      candidate?.statusCode,
      body?.code,
      nestedBody?.code,
    ),
    providerStatus: firstString(
      body?.status,
      nestedBody?.status,
      candidate?.code,
    ),
    detail: firstString(
      body?.message,
      nestedBody?.message,
      candidate?.message,
    ),
    name: firstString(candidate?.name),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function firstNumber(...values: unknown[]): number | null {
  return values.find((value): value is number => typeof value === 'number') ?? null;
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string') ?? '';
}
