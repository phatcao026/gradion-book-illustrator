// @vitest-environment node

import type { GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { PIPELINE_LIMITS } from '../pipeline-policy.js';
import {
  GEMINI_AUTOMATIC_RETRIES,
  GoogleGeminiGateway,
} from './gemini-gateway.js';
import {
  BOOK_CONTEXT_PROMPT,
  CHARACTERS_PROMPT,
  GENERATED_STYLE_PROMPT,
  chaptersPrompt,
  userStylePrompt,
} from './prompts.js';

describe('GoogleGeminiGateway request construction', () => {
  it('uploads text with automatic retries disabled', async () => {
    const upload = vi.fn().mockResolvedValue({
      name: 'files/book',
      uri: 'gemini://book',
      expirationTime: '2026-08-13T00:00:00.000Z',
    });
    const gateway = createGateway({ upload, create: vi.fn() });

    await expect(gateway.uploadBook('Saved book text', 'Story.txt')).resolves.toEqual({
      name: 'files/book',
      uri: 'gemini://book',
      expiresAt: '2026-08-13T00:00:00.000Z',
    });
    expect(upload).toHaveBeenCalledOnce();
    const request = upload.mock.calls[0]?.[0];
    expect(request.file).toBeInstanceOf(Blob);
    expect(request.config).toMatchObject({
      displayName: 'Story.txt',
      mimeType: 'text/plain',
      httpOptions: {
        retryOptions: { attempts: GEMINI_AUTOMATIC_RETRIES },
      },
    });
  });

  it('creates a stored Standard-tier book and generated-Style chain', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'book-1', output_text: 'Saved.' })
      .mockResolvedValueOnce({ id: 'style-1', output_text: 'Watercolor.' });
    const gateway = createGateway({ upload: vi.fn(), create });

    await gateway.createBookInteraction('gemini://book');
    await gateway.createStyleInteraction('book-1', '');

    expect(create).toHaveBeenNthCalledWith(
      1,
      {
        model: 'gemini-test-model',
        input: [
          { type: 'text', text: BOOK_CONTEXT_PROMPT },
          { type: 'document', uri: 'gemini://book' },
        ],
        previous_interaction_id: undefined,
        response_format: undefined,
        service_tier: 'standard',
        store: true,
      },
      { maxRetries: 0, timeout: 120_000 },
    );
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      input: GENERATED_STYLE_PROMPT,
      previous_interaction_id: 'book-1',
      store: true,
    });
  });

  it('uses the user-style prompt and a server-capped character JSON schema', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'style-user', output_text: 'Not displayed.' })
      .mockResolvedValueOnce({ id: 'characters-1', output_text: '[]' });
    const gateway = createGateway({ upload: vi.fn(), create });

    await gateway.createStyleInteraction('book-1', 'Paper collage');
    await gateway.createCharactersInteraction('style-user');

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      input: userStylePrompt('Paper collage'),
      previous_interaction_id: 'book-1',
    });
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      input: CHARACTERS_PROMPT,
      previous_interaction_id: 'style-user',
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'array',
          maxItems: PIPELINE_LIMITS.maxAdultCharacters,
        },
      },
    });
  });

  it('normalizes an expired stored interaction without retrying it', async () => {
    const create = vi.fn().mockRejectedValue({
      status: 404,
      message: 'Previous interaction expired or not found.',
    });
    const gateway = createGateway({ upload: vi.fn(), create });

    await expect(
      gateway.createCharactersInteraction('expired-style'),
    ).rejects.toMatchObject({ code: 'GEMINI_CONTEXT_EXPIRED' });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });
  });

  it('chains one structured Chapter request from persisted character context', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'chapters-1',
      output_text: '[{"name":"River","prompt":"A detailed river scene."}]',
    });
    const gateway = createGateway({ upload: vi.fn(), create });
    const characters = [
      { name: 'Mara', prompt: 'An adult river guide in a green coat.' },
    ];

    await gateway.createChaptersInteraction('characters-1', characters);

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      input: chaptersPrompt(characters),
      previous_interaction_id: 'characters-1',
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: {
          type: 'array',
          minItems: 1,
          maxItems: PIPELINE_LIMITS.maxChapters,
        },
      },
      service_tier: 'standard',
      store: true,
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });
  });
});

function createGateway(methods: {
  upload: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}): GoogleGeminiGateway {
  const client = {
    files: { upload: methods.upload },
    interactions: { create: methods.create },
  } as unknown as Pick<GoogleGenAI, 'files' | 'interactions'>;

  return new GoogleGeminiGateway(
    {
      apiKey: 'test-key',
      model: 'gemini-test-model',
      serviceTier: 'standard',
    },
    client,
  );
}
