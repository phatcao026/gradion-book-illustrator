// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { openDatabase, type AppDatabase } from './database.js';
import { PIPELINE_LIMITS } from './pipeline-policy.js';
import { AppRepository } from './repository.js';
import {
  PipelineStateError,
  PipelineStateService,
} from './pipeline-state.js';

describe('Milestone 2 durable pipeline state', () => {
  let database: AppDatabase;
  let databasePath: string;
  let temporaryDirectory: string;
  let now: number;
  let nextAttempt: number;
  let service: PipelineStateService;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'gradion-m2-'));
    databasePath = join(temporaryDirectory, 'test.sqlite');
    database = openDatabase(databasePath);
    seedProject(database);
    now = Date.parse('2026-08-11T03:00:00.000Z');
    nextAttempt = 1;
    service = new PipelineStateService(database, {
      staleAttemptMs: 10 * 60 * 1000,
      now: () => now,
      createAttemptId: () => `attempt-${nextAttempt++}`,
    });
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('rejects an out-of-order step', () => {
    expect(() => service.claimStep('user-1', 'project-1', 2)).toThrowError(
      PipelineStateError,
    );

    try {
      service.claimStep('user-1', 'project-1', 2);
    } catch (error) {
      expect(error).toMatchObject({ code: 'STEP_OUT_OF_ORDER' });
    }
  });

  it('allows only one claim across two database connections', async () => {
    const secondDatabase = openDatabase(databasePath);
    const secondService = new PipelineStateService(secondDatabase, {
      staleAttemptMs: 10 * 60 * 1000,
      now: () => now,
      createAttemptId: () => 'attempt-from-second-connection',
    });

    try {
      const results = await Promise.all([
        Promise.resolve().then(() =>
          service.claimStep('user-1', 'project-1', 1),
        ),
        Promise.resolve().then(() =>
          secondService.claimStep('user-1', 'project-1', 1),
        ),
      ]);
      const winner = results.find((result) => result.claimed);
      const loser = results.find((result) => !result.claimed);

      expect(winner).toBeDefined();
      expect(loser).toBeDefined();
      expect(loser?.state).toMatchObject({
        runState: 'RUNNING',
        attemptId: winner?.state.attemptId,
      });
    } finally {
      secondDatabase.close();
    }
  });

  it('retains failure context, then retries with a new attempt and cleared errors', () => {
    const claimed = service.claimStep('user-1', 'project-1', 1);
    const failed = service.failAttempt(
      'user-1',
      'project-1',
      claimed.state.attemptId!,
      { code: 'PROVIDER_ERROR', message: 'The provider request failed.' },
    );

    expect(failed).toMatchObject({
      applied: true,
      state: {
        completedStep: 0,
        activeStep: 1,
        runState: 'FAILED',
        attemptId: 'attempt-1',
        error: { code: 'PROVIDER_ERROR' },
      },
    });

    now += 1_000;
    const retried = service.claimStep('user-1', 'project-1', 1);
    expect(retried).toMatchObject({
      claimed: true,
      state: {
        completedStep: 0,
        activeStep: 1,
        runState: 'RUNNING',
        attemptId: 'attempt-2',
        error: null,
      },
    });
  });

  it('prevents an old attempt from completing over a newer retry', () => {
    const first = service.claimStep('user-1', 'project-1', 1);
    service.failAttempt('user-1', 'project-1', first.state.attemptId!, {
      code: 'FAILED',
      message: 'First attempt failed.',
    });
    const retry = service.claimStep('user-1', 'project-1', 1);

    expect(
      service.completeAttempt('user-1', 'project-1', first.state.attemptId!),
    ).toMatchObject({
      applied: false,
      state: { runState: 'RUNNING', attemptId: retry.state.attemptId },
    });
    expect(
      service.completeAttempt('user-1', 'project-1', retry.state.attemptId!),
    ).toMatchObject({
      applied: true,
      state: {
        completedStep: 1,
        activeStep: null,
        runState: 'IDLE',
        attemptId: null,
      },
    });
  });

  it('recovers only the exact attempt that is still running and stale', () => {
    const claimed = service.claimStep('user-1', 'project-1', 1);
    const observedStartedAt = Date.parse(claimed.state.startedAt!);
    now += 10 * 60 * 1000;

    expect(
      service.recoverStaleAttempt({
        userId: 'user-1',
        projectId: 'project-1',
        attemptId: claimed.state.attemptId!,
        observedStartedAt: observedStartedAt + 1,
      }),
    ).toMatchObject({ applied: false, state: { runState: 'RUNNING' } });

    const recovered = service.recoverStaleAttempt({
      userId: 'user-1',
      projectId: 'project-1',
      attemptId: claimed.state.attemptId!,
      observedStartedAt,
    });
    expect(recovered).toMatchObject({
      applied: true,
      state: {
        completedStep: 0,
        activeStep: 1,
        runState: 'INTERRUPTED',
        attemptId: 'attempt-1',
        error: { code: 'STALE_ATTEMPT' },
      },
    });
  });

  it('makes stale recovery a no-op if the attempt completed after it was read', () => {
    const claimed = service.claimStep('user-1', 'project-1', 1);
    const observedStartedAt = Date.parse(claimed.state.startedAt!);
    now += 10 * 60 * 1000;
    service.completeAttempt('user-1', 'project-1', claimed.state.attemptId!);

    expect(
      service.recoverStaleAttempt({
        userId: 'user-1',
        projectId: 'project-1',
        attemptId: claimed.state.attemptId!,
        observedStartedAt,
      }),
    ).toMatchObject({
      applied: false,
      state: { completedStep: 1, runState: 'IDLE' },
    });
  });

  it('restores the current attempt after closing and reopening SQLite', () => {
    const claimed = service.claimStep('user-1', 'project-1', 1);
    service.failAttempt('user-1', 'project-1', claimed.state.attemptId!, {
      code: 'PROVIDER_ERROR',
      message: 'Persist this failure.',
    });

    database.close();
    database = openDatabase(databasePath);
    service = new PipelineStateService(database, {
      staleAttemptMs: 10 * 60 * 1000,
      now: () => now,
    });

    expect(service.getState('user-1', 'project-1')).toMatchObject({
      completedStep: 0,
      activeStep: 1,
      runState: 'FAILED',
      attemptId: 'attempt-1',
      error: { code: 'PROVIDER_ERROR', message: 'Persist this failure.' },
    });
  });

  it('rechecks attempt id and timestamp in the authenticated recovery API', async () => {
    const app = createApp({
      database,
      uploadsDirectory: join(temporaryDirectory, 'uploads'),
      staleAttemptMs: 1,
    });
    const agent = request.agent(app);
    await agent
      .post('/api/session')
      .send({ name: 'Mira Hassan', email: 'mira-api@example.com' });
    const created = await agent
      .post('/api/projects')
      .field('title', 'API state project')
      .field('bookText', 'A saved source book.');
    const projectId = created.body.project.id as string;
    const userId = userIdForEmail(database, 'mira-api@example.com');
    const apiState = new PipelineStateService(database, {
      staleAttemptMs: 1,
      now: () => 1,
      createAttemptId: () => 'api-attempt',
    }).claimStep(userId, projectId, 1).state;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const mismatch = await agent
      .post(`/api/projects/${projectId}/pipeline/recover`)
      .send({ attemptId: 'wrong-attempt', startedAt: apiState.startedAt });
    expect(mismatch.status).toBe(200);
    expect(mismatch.body.recovered).toBe(false);
    expect(mismatch.body.pipeline.runState).toBe('RUNNING');

    const recovered = await agent
      .post(`/api/projects/${projectId}/pipeline/recover`)
      .send({ attemptId: apiState.attemptId, startedAt: apiState.startedAt });
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({
      recovered: true,
      pipeline: {
        runState: 'INTERRUPTED',
        attemptId: 'api-attempt',
        error: { code: 'STALE_ATTEMPT' },
      },
    });
  });

  it('declares the server-owned output caps for later result writes', () => {
    expect(PIPELINE_LIMITS.maxAdultCharacters).toBe(2);
    expect(PIPELINE_LIMITS.maxChapters).toBe(1);
  });

  it('derives Draft, In progress, and Done from persisted progress', () => {
    const repository = new AppRepository(database);
    expect(repository.listProjects('user-1')[0]?.status).toBe('DRAFT');

    for (const step of [1, 2, 3, 4, 5] as const) {
      const claim = service.claimStep('user-1', 'project-1', step);
      expect(repository.listProjects('user-1')[0]?.status).toBe('IN_PROGRESS');
      service.completeAttempt(
        'user-1',
        'project-1',
        claim.state.attemptId!,
      );
    }

    expect(repository.listProjects('user-1')[0]?.status).toBe('DONE');
  });
});

function seedProject(database: AppDatabase): void {
  database
    .prepare(
      'INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)',
    )
    .run('user-1', 'Mira Hassan', 'mira@example.com', '2026-08-11T00:00:00.000Z');
  database
    .prepare(
      'INSERT INTO projects (id, user_id, title, book_path, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'project-1',
      'user-1',
      'River Story',
      'user-1/project-1/book.txt',
      '2026-08-11T00:00:00.000Z',
    );
}

function userIdForEmail(database: AppDatabase, email: string): string {
  const row = database
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email) as unknown as { id: string };
  return row.id;
}
