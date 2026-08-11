// @vitest-environment node

import type { GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { GEMINI_AUTOMATIC_RETRIES } from './gemini-gateway.js';
import { GoogleGeminiImageGateway } from './image-gateway.js';
import { chapterIllustrationPrompt, portraitPrompt } from './prompts.js';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('GoogleGeminiImageGateway', () => {
  it('constructs a stored 1K portrait request without a seed call or retries', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'portrait-1',
      output_image: { data: pngBytes.toString('base64'), mime_type: 'image/png' },
    });
    const gateway = createGateway(create);

    await expect(
      gateway.generatePortrait({
        previousInteractionId: null,
        references: [],
        characterName: 'Mara',
        characterPrompt: 'An adult river guide in a weathered green coat.',
        style: 'Layered watercolor.',
      }),
    ).resolves.toEqual({
      interactionId: 'portrait-1',
      bytes: pngBytes,
      mimeType: 'image/png',
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      {
        model: 'gemini-image-test',
        input: portraitPrompt({
          characterName: 'Mara',
          characterPrompt: 'An adult river guide in a weathered green coat.',
          style: 'Layered watercolor.',
          hasReferencePortraits: false,
        }),
        previous_interaction_id: undefined,
        response_modalities: ['image'],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          aspect_ratio: '9:16',
          image_size: '1K',
        },
        service_tier: 'standard',
        store: true,
      },
      { maxRetries: GEMINI_AUTOMATIC_RETRIES, timeout: 180_000 },
    );
  });

  it('uses completed local portraits as references only when rebuilding', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'portrait-rebuilt',
      output_image: { data: pngBytes.toString('base64'), mime_type: 'image/png' },
    });
    const gateway = createGateway(create);

    await gateway.generatePortrait({
      previousInteractionId: null,
      references: [{ bytes: pngBytes, mimeType: 'image/png' }],
      characterName: 'Theo',
      characterPrompt: 'An adult cartographer with a leather satchel.',
      style: 'Layered watercolor.',
    });

    const request = create.mock.calls[0]?.[0];
    expect(request.previous_interaction_id).toBeUndefined();
    expect(request.input).toEqual([
      {
        type: 'text',
        text: portraitPrompt({
          characterName: 'Theo',
          characterPrompt: 'An adult cartographer with a leather satchel.',
          style: 'Layered watercolor.',
          hasReferencePortraits: true,
        }),
      },
      { type: 'image', data: pngBytes.toString('base64'), mime_type: 'image/png' },
    ]);
  });

  it.each([
    [{ data: 'not-base64', mime_type: 'image/png' }],
    [{ data: Buffer.from('not a png').toString('base64'), mime_type: 'image/png' }],
    [{ data: pngBytes.toString('base64'), mime_type: 'image/webp' }],
  ])('rejects invalid image output before it reaches storage', async (outputImage) => {
    const gateway = createGateway(
      vi.fn().mockResolvedValue({ id: 'invalid-image', output_image: outputImage }),
    );

    await expect(
      gateway.generatePortrait({
        previousInteractionId: null,
        references: [],
        characterName: 'Mara',
        characterPrompt: 'An adult river guide.',
        style: 'Watercolor.',
      }),
    ).rejects.toMatchObject({ code: 'GEMINI_INVALID_RESPONSE' });
  });

  it('normalizes an expired image interaction and still performs one call', async () => {
    const create = vi.fn().mockRejectedValue({
      status: 404,
      message: 'Previous interaction expired or not found.',
    });
    const gateway = createGateway(create);

    await expect(
      gateway.generatePortrait({
        previousInteractionId: 'expired-portrait',
        references: [],
        characterName: 'Theo',
        characterPrompt: 'An adult cartographer.',
        style: 'Watercolor.',
      }),
    ).rejects.toMatchObject({ code: 'GEMINI_CONTEXT_EXPIRED' });
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([
    [
      {
        status: 429,
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Free tier quota limit 0 for this image model.',
        },
      },
      'Gemini image generation is not enabled for this API key project.',
    ],
    [
      { status: 401, error: { message: 'API key not valid.' } },
      'Gemini rejected the API key.',
    ],
    [
      { status: 403, error: { status: 'PERMISSION_DENIED' } },
      'This API key project does not have permission',
    ],
    [
      { status: 429, error: { status: 'RESOURCE_EXHAUSTED' } },
      'Gemini image quota is unavailable or exhausted',
    ],
    [
      { name: 'APIConnectionTimeoutError', message: 'Request timed out.' },
      'The Gemini image request timed out.',
    ],
    [
      { status: 400, error: { status: 'INVALID_ARGUMENT' } },
      'Gemini rejected the image request as invalid.',
    ],
  ])('returns an actionable image-provider error for %j', async (providerError, message) => {
    const gateway = createGateway(vi.fn().mockRejectedValue(providerError));

    await expect(
      gateway.generatePortrait({
        previousInteractionId: null,
        references: [],
        characterName: 'Mara',
        characterPrompt: 'An adult river guide.',
        style: 'Watercolor.',
      }),
    ).rejects.toMatchObject({
      code: 'GEMINI_REQUEST_FAILED',
      message: expect.stringContaining(message),
    });
  });

  it('generates one 16:9 Chapter illustration directly from portrait context', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'illustration-1',
      output_image: { data: pngBytes.toString('base64'), mime_type: 'image/png' },
    });
    const gateway = createGateway(create);

    await gateway.generateChapterIllustration({
      previousInteractionId: 'portrait-2',
      references: [],
      chapterName: 'River Reunion',
      chapterPrompt: 'Mara and Theo meet beside the river at sunset.',
      style: 'Layered watercolor.',
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      {
        model: 'gemini-image-test',
        input: chapterIllustrationPrompt({
          chapterName: 'River Reunion',
          chapterPrompt: 'Mara and Theo meet beside the river at sunset.',
          style: 'Layered watercolor.',
          hasReferencePortraits: false,
        }),
        previous_interaction_id: 'portrait-2',
        response_modalities: ['image'],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          aspect_ratio: '16:9',
          image_size: '1K',
        },
        service_tier: 'standard',
        store: true,
      },
      { maxRetries: GEMINI_AUTOMATIC_RETRIES, timeout: 180_000 },
    );
  });
});

function createGateway(create: ReturnType<typeof vi.fn>): GoogleGeminiImageGateway {
  const client = {
    interactions: { create },
  } as unknown as Pick<GoogleGenAI, 'interactions'>;
  return new GoogleGeminiImageGateway(
    {
      apiKey: 'test-key',
      model: 'gemini-image-test',
      serviceTier: 'standard',
    },
    client,
  );
}
