// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { openDatabase, type AppDatabase } from './database.js';
import { GeminiGatewayError } from './gemini/gemini-gateway.js';
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

describe('Milestone 4 Portraits', () => {
  let database: AppDatabase;
  let temporaryDirectory: string;
  let uploadsDirectory: string;
  let gateway: FakeImageGateway;
  let tasks: Array<() => Promise<void>>;
  let app: Express;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'gradion-m4-'));
    uploadsDirectory = join(temporaryDirectory, 'uploads');
    database = openDatabase(join(temporaryDirectory, 'test.sqlite'));
    gateway = new FakeImageGateway();
    tasks = [];
    app = createApp({
      database,
      uploadsDirectory,
      geminiImageGateway: gateway,
      scheduleBackgroundTask: (task) => tasks.push(task),
    });
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('persists and exposes each portrait as it lands in a sequential chain', async () => {
    const { agent, projectId } = await createPortraitProject(app, database, 2);
    const first = deferred<GeneratedGeminiImage>();
    const second = deferred<GeneratedGeminiImage>();
    gateway.results.push(first.promise, second.promise);

    const claim = await agent
      .post(`/api/projects/${projectId}/pipeline/steps/3/start`)
      .send({});
    expect(claim.status).toBe(202);
    const running = takeTask(tasks)();

    await vi.waitFor(() => expect(gateway.calls).toHaveLength(1));
    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.characters.map(portraitStatus)).toEqual([
      'GENERATING',
      'QUEUED',
    ]);

    first.resolve(image('portrait-1'));
    await vi.waitFor(() => expect(gateway.calls).toHaveLength(2));
    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.characters.map(portraitStatus)).toEqual([
      'COMPLETED',
      'GENERATING',
    ]);
    const stored = portraitRows(database, projectId);
    expect(stored[0]).toMatchObject({
      status: 'COMPLETED',
      interaction_id: 'portrait-1',
      mime_type: 'image/png',
    });
    await expect(
      readFile(join(uploadsDirectory, stored[0]!.image_path!)),
    ).resolves.toEqual(pngBytes);

    second.resolve(image('portrait-2'));
    await running;
    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 3,
      runState: 'IDLE',
    });
    expect(detail.body.project.characters.map(portraitStatus)).toEqual([
      'COMPLETED',
      'COMPLETED',
    ]);
    expect(gateway.calls[0]).toMatchObject({
      previousInteractionId: null,
      references: [],
      characterName: 'Mara',
    });
    expect(gateway.calls[1]).toMatchObject({
      previousInteractionId: 'portrait-1',
      references: [],
      characterName: 'Theo',
    });

    const imageUrl = detail.body.project.characters[0].portrait.imageUrl as string;
    const served = await agent.get(imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.body).toEqual(pngBytes);

    const otherUser = request.agent(app);
    await otherUser
      .post('/api/session')
      .send({ name: 'Other User', email: 'other-m4@example.com' });
    expect((await otherUser.get(imageUrl)).status).toBe(404);
  });

  it('keeps a completed portrait and retries only the failed item', async () => {
    const { agent, projectId } = await createPortraitProject(app, database, 2);
    gateway.results.push(
      image('portrait-1'),
      new GeminiGatewayError('GEMINI_REQUEST_FAILED', 'Second portrait failed.'),
    );

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/3/start`)
      .send({});
    await runNextTask(tasks);
    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 2,
      activeStep: 3,
      runState: 'FAILED',
    });
    expect(detail.body.project.characters.map(portraitStatus)).toEqual([
      'COMPLETED',
      'FAILED',
    ]);
    const firstPath = portraitRows(database, projectId)[0]!.image_path;

    gateway.results.push(image('portrait-2-retry'));
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/3/start`)
      .send({});
    await runNextTask(tasks);

    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 3,
      runState: 'IDLE',
      error: null,
    });
    expect(gateway.calls).toHaveLength(3);
    expect(gateway.calls[2]).toMatchObject({
      previousInteractionId: 'portrait-1',
      references: [],
      characterName: 'Theo',
    });
    expect(portraitRows(database, projectId)[0]!.image_path).toBe(firstPath);
  });

  it('rebuilds expired image context from completed local portraits', async () => {
    const { agent, projectId } = await createPortraitProject(app, database, 2);
    gateway.results.push(
      image('portrait-1'),
      new GeminiGatewayError(
        'GEMINI_CONTEXT_EXPIRED',
        'The portrait chain expired.',
      ),
    );
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/3/start`)
      .send({});
    await runNextTask(tasks);
    expect(imageContextState(database, projectId)).toBe('EXPIRED');

    gateway.results.push(image('portrait-2-rebuilt'));
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/3/start`)
      .send({});
    await runNextTask(tasks);

    expect(gateway.calls[2]?.previousInteractionId).toBeNull();
    expect(gateway.calls[2]?.references).toEqual([
      { bytes: pngBytes, mimeType: 'image/png' },
    ]);
    expect(imageContextState(database, projectId)).toBe('READY');
    const detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline.completedStep).toBe(3);
  });

  it('completes an explicitly started zero-character step without image calls', async () => {
    const { agent, projectId } = await createPortraitProject(app, database, 0);

    const claim = await agent
      .post(`/api/projects/${projectId}/pipeline/steps/3/start`)
      .send({});
    expect(claim.status).toBe(202);
    await runNextTask(tasks);

    const detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline.completedStep).toBe(3);
    expect(gateway.calls).toEqual([]);
  });

  it('makes a duplicate Portraits start an idempotent loser with one task', async () => {
    const { agent, projectId } = await createPortraitProject(app, database, 1);

    const [first, second] = await Promise.all([
      agent.post(`/api/projects/${projectId}/pipeline/steps/3/start`).send({}),
      agent.post(`/api/projects/${projectId}/pipeline/steps/3/start`).send({}),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 202]);
    expect([first.body.claimed, second.body.claimed].sort()).toEqual([false, true]);
    expect(tasks).toHaveLength(1);
  });
});

class FakeImageGateway implements GeminiImageGateway {
  readonly model = 'gemini-image-test';
  readonly calls: PortraitGenerationInput[] = [];
  readonly illustrationCalls: ChapterIllustrationGenerationInput[] = [];
  readonly results: Array<
    GeneratedGeminiImage | Error | Promise<GeneratedGeminiImage>
  > = [];

  async generatePortrait(input: PortraitGenerationInput): Promise<GeneratedGeminiImage> {
    this.calls.push(input);
    const result = this.results.shift() ?? image(`portrait-${this.calls.length}`);
    if (result instanceof Error) throw result;
    return result;
  }

  async generateChapterIllustration(
    input: ChapterIllustrationGenerationInput,
  ): Promise<GeneratedGeminiImage> {
    this.illustrationCalls.push(input);
    return image(`illustration-${this.illustrationCalls.length}`);
  }
}

async function createPortraitProject(
  app: Express,
  database: AppDatabase,
  characterCount: 0 | 1 | 2,
): Promise<{ agent: ReturnType<typeof request.agent>; projectId: string }> {
  const agent = request.agent(app);
  await agent
    .post('/api/session')
    .send({ name: 'Mira Hassan', email: 'mira-m4@example.com' });
  const created = await agent
    .post('/api/projects')
    .field('title', 'Portrait Story')
    .field('bookText', 'Mara and Theo followed the river home.');
  const projectId = created.body.project.id as string;
  const user = database
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('mira-m4@example.com') as unknown as { id: string };

  database
    .prepare('UPDATE projects SET completed_step = 2 WHERE id = ?')
    .run(projectId);
  database
    .prepare(`
      INSERT INTO project_ai_contexts (
        project_id, text_model, context_state, characters_interaction_id,
        style_source, style_input, style_text, updated_at
      ) VALUES (?, 'gemini-text-test', 'READY', 'characters-1',
                'GENERATED', '', 'Layered watercolor.', ?)
    `)
    .run(projectId, '2026-08-11T00:00:00.000Z');

  const characters = [
    ['character-1', 'Mara', 'An adult river guide in a weathered green coat.'],
    ['character-2', 'Theo', 'An adult cartographer carrying a leather satchel.'],
  ] as const;
  characters.slice(0, characterCount).forEach((character, ordinal) => {
    database
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
  });
  expect(user.id).toBeTruthy();
  return { agent, projectId };
}

function portraitRows(database: AppDatabase, projectId: string) {
  return database
    .prepare(`
      SELECT portraits.status, portraits.image_path, portraits.mime_type,
             portraits.interaction_id
      FROM character_portraits AS portraits
      JOIN characters ON characters.id = portraits.character_id
      WHERE characters.project_id = ?
      ORDER BY characters.ordinal
    `)
    .all(projectId) as unknown as Array<{
    status: string;
    image_path: string | null;
    mime_type: string | null;
    interaction_id: string | null;
  }>;
}

function imageContextState(database: AppDatabase, projectId: string): string {
  return (
    database
      .prepare('SELECT image_context_state FROM project_ai_contexts WHERE project_id = ?')
      .get(projectId) as unknown as { image_context_state: string }
  ).image_context_state;
}

function portraitStatus(character: { portrait: { status: string } | null }): string | null {
  return character.portrait?.status ?? null;
}

function image(interactionId: string): GeneratedGeminiImage {
  return { interactionId, bytes: pngBytes, mimeType: 'image/png' };
}

function takeTask(tasks: Array<() => Promise<void>>): () => Promise<void> {
  const task = tasks.shift();
  if (!task) throw new Error('Expected a scheduled task.');
  return task;
}

async function runNextTask(tasks: Array<() => Promise<void>>): Promise<void> {
  await takeTask(tasks)();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
