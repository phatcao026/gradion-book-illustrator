// @vitest-environment node

import type { GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { GEMINI_AUTOMATIC_RETRIES } from './gemini-gateway.js';
import { GoogleGeminiImageGateway } from './image-gateway.js';
import { portraitPrompt } from './prompts.js';

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
        response_format: {
          type: 'image',
          mime_type: 'image/png',
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
