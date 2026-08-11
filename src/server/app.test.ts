// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from './app.js';
import { openDatabase, type AppDatabase } from './database.js';

describe('GET /api/health', () => {
  let database: AppDatabase;

  beforeEach(() => {
    database = openDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  it('returns a successful JSON response when SQLite is available', async () => {
    const response = await request(createApp({ database })).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
