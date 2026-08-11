// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { openDatabase, type AppDatabase } from './database.js';
import {
  GEMINI_AUTOMATIC_RETRIES,
  GeminiGatewayError,
  type GeminiGateway,
  type GeminiInteractionOutput,
  type UploadedGeminiFile,
} from './gemini/gemini-gateway.js';

const characterPrompt =
  'A detailed waist-up portrait with consistent facial features, clothing, lighting, and a plain background.';

describe('Milestone 3 Gemini pipeline execution', () => {
  let database: AppDatabase;
  let temporaryDirectory: string;
  let gateway: FakeGeminiGateway;
  let tasks: Array<() => Promise<void>>;
  let app: Express;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'gradion-m3-'));
    database = openDatabase(join(temporaryDirectory, 'test.sqlite'));
    gateway = new FakeGeminiGateway();
    tasks = [];
    app = createApp({
      database,
      uploadsDirectory: join(temporaryDirectory, 'uploads'),
      geminiGateway: gateway,
      scheduleBackgroundTask: (task) => tasks.push(task),
    });
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('runs generated Style and Characters in order and exposes persisted results', async () => {
    const { agent, projectId } = await createProject(app);
    gateway.styleResults.push({ id: 'style-1', text: 'Soft watercolor and pencil.' });
    gateway.characterResults.push({
      id: 'characters-1',
      text: JSON.stringify([
        { name: 'Mara', prompt: characterPrompt },
        { name: 'Theo', prompt: `${characterPrompt} Warm morning color palette.` },
      ]),
    });

    const styleClaim = await agent
      .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
      .send({ style: '' });
    expect(styleClaim.status).toBe(202);
    expect(styleClaim.body).toMatchObject({
      claimed: true,
      pipeline: { activeStep: 1, runState: 'RUNNING' },
    });

    await runNextTask(tasks);
    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project).toMatchObject({
      pipeline: { completedStep: 1, runState: 'IDLE', error: null },
      styleInput: '',
      style: { source: 'GENERATED', text: 'Soft watercolor and pencil.' },
      characters: [],
    });

    const charactersClaim = await agent
      .post(`/api/projects/${projectId}/pipeline/steps/2/start`)
      .send({});
    expect(charactersClaim.status).toBe(202);
    await runNextTask(tasks);

    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 2,
      activeStep: null,
      runState: 'IDLE',
    });
    expect(detail.body.project.characters).toEqual([
      expect.objectContaining({ name: 'Mara', prompt: characterPrompt }),
      expect.objectContaining({ name: 'Theo' }),
    ]);
    expect(gateway.bookCalls).toEqual(['gemini://files/book-1']);
    expect(gateway.styleCalls).toEqual([
      { previousInteractionId: 'book-1', styleInput: '' },
    ]);
    expect(gateway.characterCalls).toEqual(['style-1']);
  });

  it('keeps SDK automatic retry count at zero', () => {
    expect(GEMINI_AUTOMATIC_RETRIES).toBe(0);
  });

  it('accepts an exact user style and permits a book with zero adult characters', async () => {
    const { agent, projectId } = await createProject(app);
    gateway.styleResults.push({ id: 'style-user', text: 'Provider acknowledgement.' });
    gateway.characterResults.push({ id: 'characters-empty', text: '[]' });

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
      .send({ style: '  Bold paper-cut collage  ' });
    await runNextTask(tasks);

    const afterStyle = await agent.get(`/api/projects/${projectId}`);
    expect(afterStyle.body.project).toMatchObject({
      styleInput: 'Bold paper-cut collage',
      style: { source: 'USER', text: 'Bold paper-cut collage' },
    });
    expect(gateway.styleCalls[0]).toEqual({
      previousInteractionId: 'book-1',
      styleInput: 'Bold paper-cut collage',
    });

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/2/start`)
      .send({});
    await runNextTask(tasks);

    const detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline.completedStep).toBe(2);
    expect(detail.body.project.characters).toEqual([]);
  });

  it('returns an idempotent loser response and schedules only one provider run', async () => {
    const { agent, projectId } = await createProject(app);

    const [first, second] = await Promise.all([
      agent
        .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
        .send({ style: '' }),
      agent
        .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
        .send({ style: '' }),
    ]);
    const winner = [first, second].find((response) => response.body.claimed === true);
    const loser = [first, second].find((response) => response.body.claimed === false);

    expect(winner?.status).toBe(202);
    expect(loser?.status).toBe(200);
    expect(loser?.body.pipeline).toMatchObject({
      runState: 'RUNNING',
      attemptId: winner?.body.pipeline.attemptId,
    });
    expect(tasks).toHaveLength(1);
  });

  it('persists upload and book context before failure, then resumes from that boundary', async () => {
    const { agent, projectId } = await createProject(app);
    gateway.styleResults.push(
      new GeminiGatewayError(
        'GEMINI_REQUEST_FAILED',
        'The Style request failed once.',
      ),
      { id: 'style-retry', text: 'Gouache with restrained texture.' },
    );

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
      .send({ style: '' });
    await runNextTask(tasks);

    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 0,
      activeStep: 1,
      runState: 'FAILED',
      error: { code: 'GEMINI_REQUEST_FAILED' },
    });
    expect(contextRow(database, projectId)).toMatchObject({
      gemini_file_uri: 'gemini://files/book-1',
      book_interaction_id: 'book-1',
      style_interaction_id: null,
    });

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
      .send({ style: '' });
    await runNextTask(tasks);

    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 1,
      runState: 'IDLE',
      error: null,
    });
    expect(gateway.uploadCalls).toHaveLength(1);
    expect(gateway.bookCalls).toHaveLength(1);
    expect(gateway.styleCalls).toHaveLength(2);
  });

  it('enforces the two-character cap before writing results and supports explicit retry', async () => {
    const { agent, projectId } = await createProject(app);
    gateway.styleResults.push({ id: 'style-cap', text: 'Ink and watercolor.' });
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
      .send({ style: '' });
    await runNextTask(tasks);

    gateway.characterResults.push(
      {
        id: 'characters-too-many',
        text: JSON.stringify([
          { name: 'One', prompt: characterPrompt },
          { name: 'Two', prompt: characterPrompt },
          { name: 'Three', prompt: characterPrompt },
        ]),
      },
      {
        id: 'characters-retry',
        text: JSON.stringify([{ name: 'One', prompt: characterPrompt }]),
      },
    );

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/2/start`)
      .send({});
    await runNextTask(tasks);

    let detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 1,
      activeStep: 2,
      runState: 'FAILED',
      error: { code: 'GEMINI_INVALID_RESPONSE' },
    });
    expect(detail.body.project.characters).toEqual([]);

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/2/start`)
      .send({});
    await runNextTask(tasks);
    detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project.pipeline).toMatchObject({
      completedStep: 2,
      runState: 'IDLE',
      error: null,
    });
    expect(detail.body.project.characters).toHaveLength(1);
    expect(gateway.uploadCalls).toHaveLength(1);
    expect(gateway.styleCalls).toHaveLength(1);
    expect(gateway.characterCalls).toHaveLength(2);
  });

  it('marks expired context and rebuilds it from local data only after a user retry', async () => {
    const { agent, projectId } = await createProject(app);
    gateway.styleResults.push(
      { id: 'style-original', text: 'Painterly storybook art.' },
      { id: 'style-rehydrated', text: 'Provider acknowledgement.' },
    );
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/1/start`)
      .send({ style: '' });
    await runNextTask(tasks);

    gateway.characterResults.push(
      new GeminiGatewayError(
        'GEMINI_CONTEXT_EXPIRED',
        'The stored interaction expired.',
      ),
      {
        id: 'characters-after-rehydrate',
        text: JSON.stringify([{ name: 'Mara', prompt: characterPrompt }]),
      },
    );
    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/2/start`)
      .send({});
    await runNextTask(tasks);

    expect(contextRow(database, projectId).context_state).toBe('EXPIRED');
    expect(gateway.uploadCalls).toHaveLength(1);

    await agent
      .post(`/api/projects/${projectId}/pipeline/steps/2/start`)
      .send({});
    await runNextTask(tasks);

    const detail = await agent.get(`/api/projects/${projectId}`);
    expect(detail.body.project).toMatchObject({
      pipeline: { completedStep: 2, runState: 'IDLE', error: null },
      style: { source: 'GENERATED', text: 'Painterly storybook art.' },
    });
    expect(gateway.uploadCalls).toHaveLength(2);
    expect(gateway.bookCalls).toEqual([
      'gemini://files/book-1',
      'gemini://files/book-2',
    ]);
    expect(gateway.styleCalls).toEqual([
      { previousInteractionId: 'book-1', styleInput: '' },
      {
        previousInteractionId: 'book-2',
        styleInput: 'Painterly storybook art.',
      },
    ]);
    expect(gateway.characterCalls).toEqual([
      'style-original',
      'style-rehydrated',
    ]);
  });
});

class FakeGeminiGateway implements GeminiGateway {
  readonly model = 'gemini-test-model';
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
  readonly styleResults: Array<GeminiInteractionOutput | Error> = [];
  readonly characterResults: Array<GeminiInteractionOutput | Error> = [];

  async uploadBook(bookText: string, displayName: string): Promise<UploadedGeminiFile> {
    this.uploadCalls.push({ bookText, displayName });
    const number = this.uploadCalls.length;
    return {
      name: `files/book-${number}`,
      uri: `gemini://files/book-${number}`,
      expiresAt: '2026-08-13T00:00:00.000Z',
    };
  }

  async createBookInteraction(fileUri: string): Promise<GeminiInteractionOutput> {
    this.bookCalls.push(fileUri);
    return { id: `book-${this.bookCalls.length}`, text: 'Book context saved.' };
  }

  async createStyleInteraction(
    previousInteractionId: string,
    styleInput: string,
  ): Promise<GeminiInteractionOutput> {
    this.styleCalls.push({ previousInteractionId, styleInput });
    return takeResult(this.styleResults, {
      id: `style-${this.styleCalls.length}`,
      text: 'Default generated style.',
    });
  }

  async createCharactersInteraction(
    previousInteractionId: string,
  ): Promise<GeminiInteractionOutput> {
    this.characterCalls.push(previousInteractionId);
    return takeResult(this.characterResults, {
      id: `characters-${this.characterCalls.length}`,
      text: '[]',
    });
  }

  async createChaptersInteraction(
    previousInteractionId: string,
    characters: Array<{ name: string; prompt: string }>,
  ): Promise<GeminiInteractionOutput> {
    this.chapterCalls.push({ previousInteractionId, characters });
    return {
      id: `chapters-${this.chapterCalls.length}`,
      text: JSON.stringify([
        {
          name: 'Opening Scene',
          prompt:
            'A detailed single chapter scene grounded in the saved book and established adult characters.',
        },
      ]),
    };
  }
}

function takeResult(
  queue: Array<GeminiInteractionOutput | Error>,
  fallback: GeminiInteractionOutput,
): GeminiInteractionOutput {
  const result = queue.shift() ?? fallback;
  if (result instanceof Error) throw result;
  return result;
}

async function createProject(app: Express): Promise<{
  agent: ReturnType<typeof request.agent>;
  projectId: string;
}> {
  const agent = request.agent(app);
  const session = await agent
    .post('/api/session')
    .send({ name: 'Mira Hassan', email: 'mira-m3@example.com' });
  expect(session.status).toBe(200);

  const created = await agent
    .post('/api/projects')
    .field('title', 'The River Story')
    .field('bookText', 'Mara and Theo followed the river home before sunset.');
  expect(created.status).toBe(201);
  return { agent, projectId: created.body.project.id as string };
}

async function runNextTask(tasks: Array<() => Promise<void>>): Promise<void> {
  const task = tasks.shift();
  expect(task).toBeDefined();
  await task?.();
}

function contextRow(database: AppDatabase, projectId: string) {
  return database
    .prepare(`
      SELECT context_state, gemini_file_uri, book_interaction_id,
             style_interaction_id, characters_interaction_id
      FROM project_ai_contexts
      WHERE project_id = ?
    `)
    .get(projectId) as unknown as {
    context_state: string;
    gemini_file_uri: string | null;
    book_interaction_id: string | null;
    style_interaction_id: string | null;
    characters_interaction_id: string | null;
  };
}
