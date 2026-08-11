import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { TextDecoder } from 'node:util';

import cookieParser from 'cookie-parser';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import multer from 'multer';
import { z, ZodError } from 'zod';

import {
  identityInputSchema,
  MAX_BOOK_BYTES,
  pipelineStartInputSchema,
  projectTitleSchema,
  type PipelineStepNumber,
  type ProjectDetail,
  type SessionUser,
} from '../shared/contracts.js';
import { BookStorage } from './book-storage.js';
import type { AppDatabase } from './database.js';
import {
  type GeminiGateway,
  UnconfiguredGeminiGateway,
} from './gemini/gemini-gateway.js';
import {
  type GeminiImageGateway,
  UnconfiguredGeminiImageGateway,
} from './gemini/image-gateway.js';
import { ImageStorage } from './image-storage.js';
import { PipelineExecutionRepository } from './pipeline-execution-repository.js';
import { PipelineRunner } from './pipeline-runner.js';
import { AppRepository } from './repository.js';
import {
  DEFAULT_STALE_ATTEMPT_MS,
  PipelineStateError,
  PipelineStateService,
  toProjectSummary,
} from './pipeline-state.js';
import {
  clearSessionCookieOptions,
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_MS,
  sessionCookieOptions,
} from './session.js';

export interface AppDependencies {
  database: AppDatabase;
  uploadsDirectory: string;
  secureCookies?: boolean;
  staleAttemptMs?: number;
  geminiGateway?: GeminiGateway;
  geminiImageGateway?: GeminiImageGateway;
  scheduleBackgroundTask?: (task: () => Promise<void>) => void;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_BOOK_BYTES,
    fieldSize: MAX_BOOK_BYTES,
    fields: 3,
  },
});

const staleRecoverySchema = z.object({
  attemptId: z.string().min(1),
  startedAt: z.iso.datetime(),
});

export function createApp({
  database,
  uploadsDirectory,
  secureCookies = false,
  staleAttemptMs = DEFAULT_STALE_ATTEMPT_MS,
  geminiGateway = new UnconfiguredGeminiGateway('gemini-3.6-flash'),
  geminiImageGateway = new UnconfiguredGeminiImageGateway(
    'gemini-3.1-flash-image',
  ),
  scheduleBackgroundTask = defaultBackgroundScheduler,
}: AppDependencies): Express {
  const app = express();
  const repository = new AppRepository(database, staleAttemptMs);
  const pipelineState = new PipelineStateService(database, { staleAttemptMs });
  const bookStorage = new BookStorage(uploadsDirectory);
  const imageStorage = new ImageStorage(uploadsDirectory);
  const executionRepository = new PipelineExecutionRepository(database);
  const pipelineRunner = new PipelineRunner(
    geminiGateway,
    executionRepository,
    pipelineState,
    bookStorage,
    geminiImageGateway,
    imageStorage,
  );

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

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

  app.post('/api/session', (request, response, next) => {
    try {
      const input = identityInputSchema.parse(request.body);
      const now = new Date();
      const user = repository.upsertUser(
        {
          id: randomUUID(),
          name: input.name,
          email: input.email,
        },
        now.toISOString(),
      );
      const token = createSessionToken();

      repository.createSession(
        hashSessionToken(token),
        user.id,
        now.toISOString(),
        now.getTime() + SESSION_LIFETIME_MS,
      );
      response.cookie(
        SESSION_COOKIE_NAME,
        token,
        sessionCookieOptions(secureCookies),
      );
      response.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/session', requireSession(repository), (_request, response) => {
    response.status(200).json({ user: response.locals.user as SessionUser });
  });

  app.delete('/api/session', (request, response) => {
    const token = readSessionToken(request);

    if (token) {
      repository.deleteSession(hashSessionToken(token));
    }

    response.clearCookie(
      SESSION_COOKIE_NAME,
      clearSessionCookieOptions(secureCookies),
    );
    response.status(204).end();
  });

  app.get('/api/projects', requireSession(repository), (_request, response) => {
    const user = response.locals.user as SessionUser;
    response.status(200).json({ projects: repository.listProjects(user.id) });
  });

  app.post(
    '/api/projects',
    requireSession(repository),
    upload.single('bookFile'),
    async (request, response, next) => {
      const user = response.locals.user as SessionUser;
      const projectId = randomUUID();
      let bookPath: string | null = null;

      try {
        const title = projectTitleSchema.parse(request.body.title);
        const bookText = extractBookText(request);

        bookPath = await bookStorage.writeBook(user.id, projectId, bookText);

        try {
          const project = repository.createProject({
            id: projectId,
            userId: user.id,
            title,
            bookPath,
            createdAt: new Date().toISOString(),
          });
          response.status(201).json({ project });
        } catch (error) {
          await bookStorage.removeBook(bookPath).catch((cleanupError) => {
            console.error('Failed to clean up a book after database failure', cleanupError);
          });
          throw error;
        }
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/projects/:projectId',
    requireSession(repository),
    async (request, response, next) => {
      try {
        const user = response.locals.user as SessionUser;
        const projectId = request.params.projectId;

        if (typeof projectId !== 'string') {
          throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
        }

        const row = repository.findProject(user.id, projectId);

        if (!row) {
          throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
        }

        const project: ProjectDetail = {
          ...toProjectSummary(row, Date.now(), staleAttemptMs),
          bookText: await bookStorage.readBook(row.book_path),
          ...executionRepository.getOutputs(user.id, projectId),
        };

        response.status(200).json({ project });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/projects/:projectId/characters/:characterId/portrait',
    requireSession(repository),
    async (request, response, next) => {
      try {
        const user = response.locals.user as SessionUser;
        const projectId = request.params.projectId;
        const characterId = request.params.characterId;
        if (typeof projectId !== 'string' || typeof characterId !== 'string') {
          throw new ApiError(404, 'PORTRAIT_NOT_FOUND', 'Portrait was not found.');
        }

        const portrait = executionRepository.getPortraitImage(
          user.id,
          projectId,
          characterId,
        );
        if (!portrait) {
          throw new ApiError(404, 'PORTRAIT_NOT_FOUND', 'Portrait was not found.');
        }

        const bytes = await imageStorage.readImage(portrait.imagePath);
        response.setHeader('Content-Type', portrait.mimeType);
        response.setHeader('Cache-Control', 'private, max-age=3600');
        response.status(200).send(bytes);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/projects/:projectId/pipeline/steps/:step/start',
    requireSession(repository),
    (request, response, next) => {
      try {
        const user = response.locals.user as SessionUser;
        const projectId = request.params.projectId;
        const step = parseAvailableStep(request.params.step);
        const input = pipelineStartInputSchema.parse(request.body ?? {});

        if (typeof projectId !== 'string') {
          throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
        }
        if (step !== 1 && input.style.length > 0) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            'Style input is accepted only when starting the Style step.',
          );
        }

        const claim = pipelineState.claimStep(user.id, projectId, step);
        if (claim.claimed) {
          const attemptId = claim.state.attemptId;
          if (!attemptId) {
            throw new PipelineStateError(
              'STATE_CHANGED',
              'The claimed attempt is missing its identifier.',
            );
          }

          if (
            step === 1 &&
            !executionRepository.prepareStyleAttempt({
              userId: user.id,
              projectId,
              attemptId,
              styleInput: input.style,
              textModel: geminiGateway.model,
              now: new Date().toISOString(),
            })
          ) {
            pipelineState.failAttempt(user.id, projectId, attemptId, {
              code: 'PIPELINE_PREPARATION_FAILED',
              message: 'The Style request could not be saved before execution.',
            });
            throw new PipelineStateError(
              'STATE_CHANGED',
              'The Style request could not be prepared.',
            );
          }

          if (
            step === 3 &&
            !executionRepository.preparePortraitAttempt({
              userId: user.id,
              projectId,
              attemptId,
              imageModel: geminiImageGateway.model,
              now: new Date().toISOString(),
            })
          ) {
            pipelineState.failAttempt(user.id, projectId, attemptId, {
              code: 'PIPELINE_PREPARATION_FAILED',
              message: 'The Portraits request could not be saved before execution.',
            });
            throw new PipelineStateError(
              'STATE_CHANGED',
              'The Portraits request could not be prepared.',
            );
          }

          scheduleBackgroundTask(() =>
            pipelineRunner.runAttempt({
              userId: user.id,
              projectId,
              step,
              attemptId,
            }),
          );
        }

        response.status(claim.claimed ? 202 : 200).json({
          claimed: claim.claimed,
          pipeline: claim.state,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/projects/:projectId/pipeline/recover',
    requireSession(repository),
    (request, response, next) => {
      try {
        const user = response.locals.user as SessionUser;
        const projectId = request.params.projectId;
        const input = staleRecoverySchema.parse(request.body);

        if (typeof projectId !== 'string') {
          throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found.');
        }

        const result = pipelineState.recoverStaleAttempt({
          userId: user.id,
          projectId,
          attemptId: input.attemptId,
          observedStartedAt: Date.parse(input.startedAt),
        });

        response.status(200).json({
          recovered: result.applied,
          pipeline: result.state,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (error instanceof ApiError) {
        response
          .status(error.status)
          .json({ error: { code: error.code, message: error.message } });
        return;
      }

      if (error instanceof PipelineStateError) {
        const status = error.code === 'PROJECT_NOT_FOUND' ? 404 : 409;
        response.status(status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }

      if (error instanceof ZodError) {
        response.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.issues[0]?.message ?? 'Request validation failed.',
          },
        });
        return;
      }

      if (error instanceof multer.MulterError) {
        const fileTooLarge = error.code === 'LIMIT_FILE_SIZE';
        response.status(fileTooLarge ? 413 : 400).json({
          error: {
            code: fileTooLarge ? 'BOOK_TOO_LARGE' : 'UPLOAD_ERROR',
            message: fileTooLarge
              ? 'Book files must be 2 MiB or smaller.'
              : 'The book upload could not be processed.',
          },
        });
        return;
      }

      console.error(error);
      response.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected server error occurred.',
        },
      });
    },
  );

  return app;
}

function parseAvailableStep(
  value: string | string[] | undefined,
): Extract<PipelineStepNumber, 1 | 2 | 3> {
  if (Array.isArray(value)) {
    throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Invalid pipeline step.');
  }
  const step = Number(value);
  if (step === 1 || step === 2 || step === 3) return step;
  throw new ApiError(
    409,
    'STEP_NOT_AVAILABLE',
    'Only Style, Characters, and Portraits are available through Milestone 4.',
  );
}

function defaultBackgroundScheduler(task: () => Promise<void>): void {
  setImmediate(() => {
    void task().catch((error) => {
      console.error('Unhandled pipeline background task failure', error);
    });
  });
}

function requireSession(repository: AppRepository): RequestHandler {
  return (request, response, next) => {
    const token = readSessionToken(request);

    if (!token) {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));
      return;
    }

    const user = repository.findSessionUser(
      hashSessionToken(token),
      Date.now(),
    );

    if (!user) {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Session has expired.'));
      return;
    }

    response.locals.user = user;
    next();
  };
}

function readSessionToken(request: Request): string | null {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function extractBookText(request: Request): string {
  const pastedText =
    typeof request.body.bookText === 'string' ? request.body.bookText : '';
  const hasPastedText = pastedText.trim().length > 0;
  const hasFile = Boolean(request.file);

  if (hasPastedText === hasFile) {
    throw new ApiError(
      400,
      'BOOK_SOURCE_INVALID',
      'Provide exactly one book source: pasted text or one .txt file.',
    );
  }

  if (hasPastedText) {
    if (Buffer.byteLength(pastedText, 'utf8') > MAX_BOOK_BYTES) {
      throw new ApiError(
        413,
        'BOOK_TOO_LARGE',
        'Book text must be 2 MiB or smaller.',
      );
    }

    return pastedText.replace(/^\uFEFF/, '');
  }

  const file = request.file;

  if (!file || extname(file.originalname).toLowerCase() !== '.txt') {
    throw new ApiError(400, 'BOOK_FILE_INVALID', 'Upload a valid .txt file.');
  }

  let decoded: string;

  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
  } catch {
    throw new ApiError(
      400,
      'BOOK_FILE_ENCODING_INVALID',
      'The .txt file must contain valid UTF-8 text.',
    );
  }

  decoded = decoded.replace(/^\uFEFF/, '');

  if (decoded.trim().length === 0) {
    throw new ApiError(400, 'BOOK_EMPTY', 'Book text cannot be empty.');
  }

  return decoded;
}
