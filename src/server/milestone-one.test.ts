// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { openDatabase, type AppDatabase } from './database.js';
import { hashSessionToken } from './session.js';

describe('Milestone 1 identity and projects', () => {
  let database: AppDatabase;
  let databasePath: string;
  let temporaryDirectory: string;
  let uploadsDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'gradion-m1-'));
    databasePath = join(temporaryDirectory, 'test.sqlite');
    uploadsDirectory = join(temporaryDirectory, 'uploads');
    database = openDatabase(databasePath);
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function app(options?: { secureCookies?: boolean }): Express {
    return createApp({
      database,
      uploadsDirectory,
      secureCookies: options?.secureCookies,
    });
  }

  it('validates identity and stores only a SHA-256 session token hash', async () => {
    const invalid = await request(app()).post('/api/session').send({
      name: 'A',
      email: 'not-an-email',
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const response = await request(app({ secureCookies: true }))
      .post('/api/session')
      .send({ name: 'Mira Hassan', email: 'MIRA@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      name: 'Mira Hassan',
      email: 'mira@example.com',
    });

    const setCookie = response.headers['set-cookie']?.[0];
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');

    const rawToken = readCookieToken(setCookie);
    const stored = database
      .prepare('SELECT token_hash FROM sessions')
      .get() as unknown as { token_hash: string };

    expect(stored.token_hash).toBe(hashSessionToken(rawToken));
    expect(stored.token_hash).toHaveLength(64);
    expect(stored.token_hash).not.toBe(rawToken);

    const developmentCookie = (
      await request(app())
        .post('/api/session')
        .send({ name: 'Theo Tran', email: 'theo@example.com' })
    ).headers['set-cookie']?.[0];
    expect(developmentCookie).not.toContain('Secure');
  });

  it('deletes the current server-side session on sign out', async () => {
    const agent = request.agent(app());
    await signIn(agent, 'Mira Hassan', 'mira@example.com');

    const signedOut = await agent.delete('/api/session');
    expect(signedOut.status).toBe(204);

    const sessionCount = database
      .prepare('SELECT COUNT(*) AS count FROM sessions')
      .get() as unknown as { count: number };
    expect(sessionCount.count).toBe(0);

    const afterSignOut = await agent.get('/api/projects');
    expect(afterSignOut.status).toBe(401);
  });

  it('creates, stores, lists, and reopens a pasted-text project', async () => {
    const agent = request.agent(app());
    await signIn(agent, 'Mira Hassan', 'mira@example.com');

    const created = await agent
      .post('/api/projects')
      .field('title', 'The River Story')
      .field('bookText', 'Once upon a time beside the river.');

    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({
      title: 'The River Story',
      status: 'DRAFT',
      pipeline: {
        completedStep: 0,
        runState: 'IDLE',
        nextStep: 1,
      },
    });

    const row = database
      .prepare('SELECT book_path FROM projects WHERE id = ?')
      .get(created.body.project.id) as unknown as { book_path: string };
    await expect(
      readFile(join(uploadsDirectory, row.book_path), 'utf8'),
    ).resolves.toBe('Once upon a time beside the river.');

    const list = await agent.get('/api/projects');
    expect(list.status).toBe(200);
    expect(list.body.projects).toHaveLength(1);

    const detail = await agent.get(
      `/api/projects/${created.body.project.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.project.bookText).toBe(
      'Once upon a time beside the river.',
    );
  });

  it('accepts only one source and validates .txt content as UTF-8', async () => {
    const agent = request.agent(app());
    await signIn(agent, 'Mira Hassan', 'mira@example.com');

    const bothSources = await agent
      .post('/api/projects')
      .field('title', 'Ambiguous Book')
      .field('bookText', 'Pasted text')
      .attach('bookFile', Buffer.from('Uploaded text'), 'book.txt');
    expect(bothSources.status).toBe(400);
    expect(bothSources.body.error.code).toBe('BOOK_SOURCE_INVALID');

    const invalidUtf8 = await agent
      .post('/api/projects')
      .field('title', 'Broken Encoding')
      .attach('bookFile', Buffer.from([0xc3, 0x28]), 'book.txt');
    expect(invalidUtf8.status).toBe(400);
    expect(invalidUtf8.body.error.code).toBe(
      'BOOK_FILE_ENCODING_INVALID',
    );

    const validFile = await agent
      .post('/api/projects')
      .field('title', 'Uploaded Book')
      .attach('bookFile', Buffer.from('Valid UTF-8 text'), 'book.txt');
    expect(validFile.status).toBe(201);
  });

  it('keeps projects isolated between users', async () => {
    const mira = request.agent(app());
    const theo = request.agent(app());
    await signIn(mira, 'Mira Hassan', 'mira@example.com');
    await signIn(theo, 'Theo Tran', 'theo@example.com');

    const created = await mira
      .post('/api/projects')
      .field('title', 'Mira Book')
      .field('bookText', 'Private to Mira');

    const theoList = await theo.get('/api/projects');
    expect(theoList.body.projects).toEqual([]);

    const theoDetail = await theo.get(
      `/api/projects/${created.body.project.id}`,
    );
    expect(theoDetail.status).toBe(404);
  });

  it('reopens the same session and project after the database is reopened', async () => {
    const firstApp = app();
    const sessionResponse = await request(firstApp)
      .post('/api/session')
      .send({ name: 'Mira Hassan', email: 'mira@example.com' });
    const cookie = responseCookie(sessionResponse.headers['set-cookie']?.[0]);

    await request(firstApp)
      .post('/api/projects')
      .set('Cookie', cookie)
      .field('title', 'Persistent Book')
      .field('bookText', 'This survives a restart.');

    database.close();
    database = openDatabase(databasePath);

    const reopened = await request(app())
      .get('/api/projects')
      .set('Cookie', cookie);

    expect(reopened.status).toBe(200);
    expect(reopened.body.projects).toHaveLength(1);
    expect(reopened.body.projects[0].title).toBe('Persistent Book');
  });
});

async function signIn(
  agent: ReturnType<typeof request.agent>,
  name: string,
  email: string,
): Promise<void> {
  const response = await agent.post('/api/session').send({ name, email });
  expect(response.status).toBe(200);
}

function responseCookie(setCookie: string | undefined): string {
  if (!setCookie) {
    throw new Error('Expected a session cookie');
  }

  return setCookie.split(';', 1)[0];
}

function readCookieToken(setCookie: string | undefined): string {
  return responseCookie(setCookie).split('=', 2)[1] ?? '';
}
