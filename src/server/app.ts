import express, { type Express } from 'express';

import type { AppDatabase } from './database.js';

export interface AppDependencies {
  database: AppDatabase;
}

export function createApp({ database }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_request, response, next) => {
    try {
      const row = database.prepare('SELECT 1 AS ok').get() as { ok: number };

      if (row.ok !== 1) {
        throw new Error('SQLite readiness check failed');
      }

      response.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(error);
      response.status(500).json({ status: 'error' });
    },
  );

  return app;
}
