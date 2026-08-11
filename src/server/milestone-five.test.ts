// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { openDatabase, type AppDatabase } from './database.js';
import {
  GeminiGatewayError,
  type GeminiGateway,
  type GeminiInteractionOutput,
  type UploadedGeminiFile,
} from './gemini/gemini-gateway.js';
import type {
  ChapterIllustrationGenerationInput,
  GeneratedGeminiImage,
  GeminiImageGateway,
  PortraitGenerationInput,
} from './gemini/image-gateway.js';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const chapterPrompt =
  'A cinematic riverbank reunion at sunset, with the established adult characters greeting one another beside a weathered wooden boat.';

describe('Milestone 5 Chapters and Illustrations', () => {
  let database: AppDatabase;
  let temporaryDirectory: string;
  let uploadsDirectory: string;
  let textGateway: FakeTextGateway;
  let imageGateway: FakeImageGateway;
  let tasks: Array<() => Promise<void>>;
  let app: Express;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'gradion-m5-'));
    uploadsDirectory = join(temporaryDirectory, 'uploads');
    database = openDatabase(join(temporaryDirectory, 'test.sqlite'));
    textGateway = new FakeTextGateway();
    imageGateway = new FakeImageGateway();
    tasks = [];
    app = createApp({
      database,
      uploadsDirectory,
      geminiGateway: textGateway,
      geminiImageGateway: imageGateway,
      scheduleBackgroundTask: (task) => tasks.push(task),
    });
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('keeps Chapters and Illustrations server-locked in pipeline order', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/session')
      .send({ name: 'Mira Hassan', email: 'order-m5@example.com' });
    const created = await agent
      .post('/api/projects')
      .field('title', 'Ordered Story')
      .field('bookText', 'A complete book that has not run any pipeline step.');
    const projectId = created.body.project.id as string;

    expect(
      (await agent.post(`/api/projects/${projectId}/pipeline/steps/4/start`).send({}))
        .status,
    ).toBe(409);
    expect(
      (await agent.post(`/api/projects/${projectId}/pipeline/steps/5/start`).send({}))
        .status,
    ).toBe(409);
    expect(tasks).toEqual([]);
    expect(textGateway.chapterCalls).toEqual([]);
    expect(imageGateway.illustrationCalls).toEqual([]);
  });

  it('runs one Chapter then one chained Illustration and serves the saved image', async () => {
    const { agent, projectId } = await createM5Project({
      app,
      database,
      uploadsDirectory,
      characterCount: 2,
    });
    textGateway.chapterResults.push(chapter('chapters-1'));

    const chapterClaim = await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    expect(chapterClaim.status).toBe(202);
    await runNextTask(tasks);

    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 4,
      runState: 'IDLE',
    });
    expect(detail.body.project.chapters).toEqual([
      expect.objectContaining({
        name: 'River Reunion',
        prompt: chapterPrompt,
        illustration: null,
      }),
    ]);
    expect(textGateway.chapterCalls).toEqual([
      expect.objectContaining({
        previousInteractionId: 'characters-original',
        characters: [
          expect.objectContaining({ name: 'Mara' }),
          expect.objectContaining({ name: 'Theo' }),
        ],
      }),
    ]);

    imageGateway.illustrationResults.push(image('illustration-1'));
    const illustrationClaim = await agent
      .post(`/api/projects/${projectId}/pipeline/steps/5/start`)
      .send({});
    expect(illustrationClaim.status).toBe(202);

    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.chapters[0].illustration.status).toBe('QUEUED');
    await runNextTask(tasks);

    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project).toMatchObject({
      status: 'DONE',
      pipeline: { completedStep: 5, runState: 'IDLE' },
    });
    expect(detail.body.project.chapters[0].illustration).toMatchObject({
      status: 'COMPLETED',
      mimeType: 'image/png',
    });
    expect(imageGateway.illustrationCalls).toEqual([
      expect.objectContaining({
        previousInteractionId: 'portrait-2',
        references: [],
        chapterName: 'River Reunion',
        chapterPrompt,
        style: 'Layered watercolor.',
      }),
    ]);

    const imageUrl = detail.body.project.chapters[0].illustration.imageUrl as string;
    const served = await agent.get(imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.body).toEqual(pngBytes);

    const otherUser = request.agent(app);
    await otherUser
      .post('/api/session')
      .send({ name: 'Other User', email: 'other-m5@example.com' });
    expect((await otherUser.get(imageUrl)).status).toBe(404);
  });

  it('rejects an empty chapter result and retries only Chapters', async () => {
    const { agent, projectId } = await createM5Project({
      app,
      database,
      uploadsDirectory,
      characterCount: 1,
    });
    textGateway.chapterResults.push(
      { id: 'chapters-empty', text: '[]' },
      chapter('chapters-retry'),
    );

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    await runNextTask(tasks);
    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project).toMatchObject({
      pipeline: {
        completedStep: 3,
        activeStep: 4,
        runState: 'FAILED',
        error: { code: 'GEMINI_INVALID_RESPONSE' },
      },
      chapters: [],
    });

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    await runNextTask(tasks);
    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline.completedStep).toBe(4);
    expect(detail.body.project.chapters).toHaveLength(1);
    expect(textGateway.chapterCalls).toHaveLength(2);
    expect(imageGateway.illustrationCalls).toEqual([]);
  });

  it('rebuilds expired text context without regenerating Characters', async () => {
    const { agent, projectId } = await createM5Project({
      app,
      database,
      uploadsDirectory,
      characterCount: 1,
    });
    textGateway.chapterResults.push(
      new GeminiGatewayError(
        'GEMINI_CONTEXT_EXPIRED',
        'The saved text interaction expired.',
      ),
      chapter('chapters-rebuilt'),
    );

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    await runNextTask(tasks);
    expect(contextState(database, projectId).context_state).toBe('EXPIRED');

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    await runNextTask(tasks);

    expect(textGateway.uploadCalls).toHaveLength(1);
    expect(textGateway.bookCalls).toEqual(['gemini://files/rebuilt-1']);
    expect(textGateway.styleCalls).toEqual([
      {
        previousInteractionId: 'book-rebuilt-1',
        styleInput: 'Layered watercolor.',
      },
    ]);
    expect(textGateway.characterCalls).toEqual([]);
    expect(textGateway.chapterCalls[1]).toMatchObject({
      previousInteractionId: 'style-rebuilt-1',
      characters: [expect.objectContaining({ name: 'Mara' })],
    });
    expect(contextState(database, projectId)).toMatchObject({
      context_state: 'READY',
      chapters_interaction_id: 'chapters-rebuilt',
    });
  });

  it('rebuilds expired image context from local portraits and retries only Illustration', async () => {
    const { agent, projectId } = await createM5Project({
      app,
      database,
      uploadsDirectory,
      characterCount: 2,
    });
    textGateway.chapterResults.push(chapter('chapters-1'));
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    await runNextTask(tasks);

    imageGateway.illustrationResults.push(
      new GeminiGatewayError(
        'GEMINI_CONTEXT_EXPIRED',
        'The saved image interaction expired.',
      ),
      image('illustration-rebuilt'),
    );
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/5/start`)
      .send({});
    await runNextTask(tasks);

    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 4,
      activeStep: 5,
      runState: 'FAILED',
    });
    expect(detail.body.project.chapters[0].illustration.status).toBe('FAILED');
    expect(contextState(database, projectId).image_context_state).toBe('EXPIRED');

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/5/start`)
      .send({});
    await runNextTask(tasks);
    detail = await agent.get(`/api/projects/${projectId}`);

    expect(imageGateway.illustrationCalls).toHaveLength(2);
    expect(imageGateway.illustrationCalls[1]).toMatchObject({
      previousInteractionId: null,
      references: [
        { bytes: pngBytes, mimeType: 'image/png' },
        { bytes: pngBytes, mimeType: 'image/png' },
      ],
    });
    expect(detail.body.project.pipeline.completedStep).toBe(5);
    expect(detail.body.project.characters.map(portraitStatus)).toEqual([
      'COMPLETED',
      'COMPLETED',
    ]);
  });

  it('generates the chapter illustration without references when there are no adults', async () => {
    const { agent, projectId } = await createM5Project({
      app,
      database,
      uploadsDirectory,
      characterCount: 0,
    });
    textGateway.chapterResults.push(chapter('chapters-no-adults'));
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/4/start`)
      .send({});
    await runNextTask(tasks);

    imageGateway.illustrationResults.push(image('illustration-no-adults'));
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/5/start`)
      .send({});
    await runNextTask(tasks);

    expect(imageGateway.illustrationCalls).toEqual([
      expect.objectContaining({
        previousInteractionId: null,
        references: [],
      }),
    ]);
    const detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.status).toBe('DONE');
  });
});

class FakeTextGateway implements GeminiGateway {
  readonly model = 'gemini-text-test';
  readonly uploadCalls: Array<{ bookText: string; displayName: string }> = [];
  readonly bookCalls: string[] = [];
  readonly styleCalls: Array<{
    previousInteractionId: string;
    styleInput: string;
  }> = [];
  readonly characterCalls: string[] = [];
  readonly chapterCalls: Array<{
    previousInteractionId: string;
    characters: Array<{ name: string; prompt: string }>;
  }> = [];
  readonly chapterResults: Array<GeminiInteractionOutput | Error> = [];

  async uploadBook(
    bookText: string,
    displayName: string,
  ): Promise<UploadedGeminiFile> {
    this.uploadCalls.push({ bookText, displayName });
    const number = this.uploadCalls.length;
    return {
      name: `files/rebuilt-${number}`,
      uri: `gemini://files/rebuilt-${number}`,
      expiresAt: null,
    };
  }

  async createBookInteraction(fileUri: string): Promise<GeminiInteractionOutput> {
    this.bookCalls.push(fileUri);
    return {
      id: `book-rebuilt-${this.bookCalls.length}`,
      text: 'Book context rebuilt.',
    };
  }

  async createStyleInteraction(
    previousInteractionId: string,
    styleInput: string,
  ): Promise<GeminiInteractionOutput> {
    this.styleCalls.push({ previousInteractionId, styleInput });
    return {
      id: `style-rebuilt-${this.styleCalls.length}`,
      text: 'Style context rebuilt.',
    };
  }

  async createCharactersInteraction(
    previousInteractionId: string,
  ): Promise<GeminiInteractionOutput> {
    this.characterCalls.push(previousInteractionId);
    return { id: 'unexpected-characters', text: '[]' };
  }

  async createChaptersInteraction(
    previousInteractionId: string,
    characters: Array<{ name: string; prompt: string }>,
  ): Promise<GeminiInteractionOutput> {
    this.chapterCalls.push({ previousInteractionId, characters });
    return takeResult(this.chapterResults, chapter('chapters-default'));
  }
}

class FakeImageGateway implements GeminiImageGateway {
  readonly model = 'gemini-image-test';
  readonly portraitCalls: PortraitGenerationInput[] = [];
  readonly illustrationCalls: ChapterIllustrationGenerationInput[] = [];
  readonly illustrationResults: Array<GeneratedGeminiImage | Error> = [];

  async generatePortrait(
    input: PortraitGenerationInput,
  ): Promise<GeneratedGeminiImage> {
    this.portraitCalls.push(input);
    return image('unexpected-portrait');
  }

  async generateChapterIllustration(
    input: ChapterIllustrationGenerationInput,
  ): Promise<GeneratedGeminiImage> {
    this.illustrationCalls.push(input);
    return takeResult(
      this.illustrationResults,
      image(`illustration-${this.illustrationCalls.length}`),
    );
  }
}

async function createM5Project(input: {
  app: Express;
  database: AppDatabase;
  uploadsDirectory: string;
  characterCount: 0 | 1 | 2;
}): Promise<{ agent: ReturnType<typeof request.agent>; projectId: string }> {
  const agent = request.agent(input.app);
  await agent
    .post('/api/session')
    .send({ name: 'Mira Hassan', email: 'mira-m5@example.com' });
  const created = await agent
    .post('/api/projects')
    .field('title', 'Completed Portrait Story')
    .field('bookText', 'Mara and Theo returned to the riverbank before sunset.');
  const projectId = created.body.project.id as string;
  const user = input.database
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('mira-m5@example.com') as unknown as { id: string };

  input.database
    .prepare('UPDATE projects SET completed_step = 3 WHERE id = ?')
    .run(projectId);
  input.database
    .prepare(`
      INSERT INTO project_ai_contexts (
        project_id, text_model, context_state, gemini_file_name,
        gemini_file_uri, book_interaction_id,
        style_interaction_id, characters_interaction_id, style_source,
        style_input, style_text, image_model, image_context_state, updated_at
      ) VALUES (?, 'gemini-text-test', 'READY', 'files/original',
                'gemini://files/original', 'book-original',
                'style-original', 'characters-original', 'GENERATED', '',
                'Layered watercolor.', 'gemini-image-test', 'READY', ?)
    `)
    .run(projectId, '2026-08-11T00:00:00.000Z');

  const characters = [
    ['character-1', 'Mara', 'An adult river guide in a weathered green coat.'],
    ['character-2', 'Theo', 'An adult cartographer carrying a leather satchel.'],
  ] as const;
  for (const [ordinal, character] of characters
    .slice(0, input.characterCount)
    .entries()) {
    input.database
      .prepare(`
        INSERT INTO characters (id, project_id, ordinal, name, prompt, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        character[0],
        projectId,
        ordinal,
        character[1],
        character[2],
        '2026-08-11T00:00:00.000Z',
      );
    const imagePath = join(
      user.id,
      projectId,
      'portraits',
      `${character[0]}.png`,
    );
    const absolutePath = join(input.uploadsDirectory, imagePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, pngBytes);
    input.database
      .prepare(`
        INSERT INTO character_portraits (
          character_id, status, image_path, mime_type, interaction_id, updated_at
        ) VALUES (?, 'COMPLETED', ?, 'image/png', ?, ?)
      `)
      .run(
        character[0],
        imagePath,
        `portrait-${ordinal + 1}`,
        '2026-08-11T00:00:00.000Z',
      );
  }
  return { agent, projectId };
}

function chapter(id: string): GeminiInteractionOutput {
  return {
    id,
    text: JSON.stringify([{ name: 'River Reunion', prompt: chapterPrompt }]),
  };
}

function image(interactionId: string): GeneratedGeminiImage {
  return { interactionId, bytes: pngBytes, mimeType: 'image/png' };
}

function takeResult<T>(queue: Array<T | Error>, fallback: T): T {
  const result = queue.shift() ?? fallback;
  if (result instanceof Error) throw result;
  return result;
}

function contextState(database: AppDatabase, projectId: string) {
  return database
    .prepare(`
      SELECT context_state, image_context_state, chapters_interaction_id
      FROM project_ai_contexts WHERE project_id = ?
    `)
    .get(projectId) as unknown as {
    context_state: string;
    image_context_state: string;
    chapters_interaction_id: string | null;
  };
}

function portraitStatus(character: { portrait: { status: string } | null }) {
  return character.portrait?.status ?? null;
}

async function runNextTask(tasks: Array<() => Promise<void>>): Promise<void> {
  const task = tasks.shift();
  expect(task).toBeDefined();
  await task?.();
}
