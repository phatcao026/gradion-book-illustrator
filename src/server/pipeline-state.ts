import { randomUUID } from 'node:crypto';

import type {
  PipelineRunState,
  PipelineState,
  PipelineStepNumber,
  ProjectStatus,
  ProjectSummary,
} from '../shared/contracts.js';
import type { AppDatabase } from './database.js';

export const DEFAULT_STALE_ATTEMPT_MS = 10 * 60 * 1000;

export interface PipelineProjectRow {
  id: string;
  title: string;
  book_path: string;
  created_at: string;
  completed_step: number;
  active_step: number | null;
  run_state: PipelineRunState;
  attempt_id: string | null;
  started_at: number | null;
  error_code: string | null;
  error_message: string | null;
}

interface OwnedPipelineRow extends PipelineProjectRow {
  user_id: string;
}

export interface ClaimResult {
  claimed: boolean;
  state: PipelineState;
}

export interface TransitionResult {
  applied: boolean;
  state: PipelineState;
}

export class PipelineStateError extends Error {
  constructor(
    readonly code: 'PROJECT_NOT_FOUND' | 'STEP_OUT_OF_ORDER' | 'STATE_CHANGED',
    message: string,
  ) {
    super(message);
  }
}

export interface PipelineStateOptions {
  staleAttemptMs?: number;
  now?: () => number;
  createAttemptId?: () => string;
}

export class PipelineStateService {
  private readonly staleAttemptMs: number;
  private readonly now: () => number;
  private readonly createAttemptId: () => string;

  constructor(
    private readonly database: AppDatabase,
    options: PipelineStateOptions = {},
  ) {
    this.staleAttemptMs =
      options.staleAttemptMs ?? DEFAULT_STALE_ATTEMPT_MS;
    this.now = options.now ?? Date.now;
    this.createAttemptId = options.createAttemptId ?? randomUUID;
  }

  getState(userId: string, projectId: string): PipelineState | null {
    const row = this.findOwnedProject(userId, projectId);
    return row ? toPipelineState(row, this.now(), this.staleAttemptMs) : null;
  }

  claimStep(
    userId: string,
    projectId: string,
    requestedStep: PipelineStepNumber,
  ): ClaimResult {
    const observed = this.requireOwnedProject(userId, projectId);

    if (
      observed.run_state === 'RUNNING' &&
      observed.active_step === requestedStep
    ) {
      return {
        claimed: false,
        state: toPipelineState(observed, this.now(), this.staleAttemptMs),
      };
    }

    const expectedStep = observed.completed_step + 1;
    if (
      expectedStep > 5 ||
      requestedStep !== expectedStep ||
      (observed.run_state !== 'IDLE' &&
        observed.active_step !== requestedStep)
    ) {
      throw new PipelineStateError(
        'STEP_OUT_OF_ORDER',
        `Step ${requestedStep} cannot run after completed step ${observed.completed_step}.`,
      );
    }

    const attemptId = this.createAttemptId();
    const startedAt = this.now();
    const update = this.database
      .prepare(`
        UPDATE projects
        SET active_step = ?,
            run_state = 'RUNNING',
            attempt_id = ?,
            started_at = ?,
            error_code = NULL,
            error_message = NULL
        WHERE id = ?
          AND user_id = ?
          AND completed_step = ?
          AND run_state = ?
          AND active_step IS ?
          AND attempt_id IS ?
          AND started_at IS ?
      `)
      .run(
        requestedStep,
        attemptId,
        startedAt,
        projectId,
        userId,
        observed.completed_step,
        observed.run_state,
        observed.active_step,
        observed.attempt_id,
        observed.started_at,
      );

    if (Number(update.changes) === 1) {
      return {
        claimed: true,
        state: toPipelineState(
          this.requireOwnedProject(userId, projectId),
          this.now(),
          this.staleAttemptMs,
        ),
      };
    }

    const current = this.requireOwnedProject(userId, projectId);
    if (
      current.run_state === 'RUNNING' &&
      current.active_step === requestedStep
    ) {
      return {
        claimed: false,
        state: toPipelineState(current, this.now(), this.staleAttemptMs),
      };
    }

    throw new PipelineStateError(
      'STATE_CHANGED',
      'Project state changed before the step could be claimed.',
    );
  }

  completeAttempt(
    userId: string,
    projectId: string,
    attemptId: string,
  ): TransitionResult {
    const update = this.database
      .prepare(`
        UPDATE projects
        SET completed_step = active_step,
            active_step = NULL,
            run_state = 'IDLE',
            attempt_id = NULL,
            started_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE id = ?
          AND user_id = ?
          AND run_state = 'RUNNING'
          AND active_step IS NOT NULL
          AND attempt_id = ?
      `)
      .run(projectId, userId, attemptId);

    return this.transitionResult(userId, projectId, update.changes);
  }

  failAttempt(
    userId: string,
    projectId: string,
    attemptId: string,
    error: { code: string; message: string },
  ): TransitionResult {
    const update = this.database
      .prepare(`
        UPDATE projects
        SET run_state = 'FAILED',
            error_code = ?,
            error_message = ?
        WHERE id = ?
          AND user_id = ?
          AND run_state = 'RUNNING'
          AND active_step IS NOT NULL
          AND attempt_id = ?
      `)
      .run(error.code, error.message, projectId, userId, attemptId);

    return this.transitionResult(userId, projectId, update.changes);
  }

  recoverStaleAttempt(input: {
    userId: string;
    projectId: string;
    attemptId: string;
    observedStartedAt: number;
  }): TransitionResult {
    const cutoff = this.now() - this.staleAttemptMs;
    const update = this.database
      .prepare(`
        UPDATE projects
        SET run_state = 'INTERRUPTED',
            error_code = 'STALE_ATTEMPT',
            error_message = 'The previous attempt was interrupted and can be retried.'
        WHERE id = ?
          AND user_id = ?
          AND run_state = 'RUNNING'
          AND attempt_id = ?
          AND started_at = ?
          AND started_at <= ?
      `)
      .run(
        input.projectId,
        input.userId,
        input.attemptId,
        input.observedStartedAt,
        cutoff,
      );

    return this.transitionResult(
      input.userId,
      input.projectId,
      update.changes,
    );
  }

  private transitionResult(
    userId: string,
    projectId: string,
    changes: number | bigint,
  ): TransitionResult {
    const current = this.requireOwnedProject(userId, projectId);
    return {
      applied: Number(changes) === 1,
      state: toPipelineState(current, this.now(), this.staleAttemptMs),
    };
  }

  private requireOwnedProject(
    userId: string,
    projectId: string,
  ): OwnedPipelineRow {
    const row = this.findOwnedProject(userId, projectId);
    if (!row) {
      throw new PipelineStateError(
        'PROJECT_NOT_FOUND',
        'Project was not found.',
      );
    }
    return row;
  }

  private findOwnedProject(
    userId: string,
    projectId: string,
  ): OwnedPipelineRow | null {
    return (
      (this.database
        .prepare(`
          SELECT id, user_id, title, book_path, created_at,
                 completed_step, active_step, run_state, attempt_id,
                 started_at, error_code, error_message
          FROM projects
          WHERE id = ? AND user_id = ?
        `)
        .get(projectId, userId) as unknown as OwnedPipelineRow | undefined) ??
      null
    );
  }
}

export function toProjectSummary(
  row: PipelineProjectRow,
  now: number,
  staleAttemptMs: number,
): ProjectSummary {
  const pipeline = toPipelineState(row, now, staleAttemptMs);
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    status: projectStatus(pipeline),
    pipeline,
  };
}

export function toPipelineState(
  row: PipelineProjectRow,
  now: number,
  staleAttemptMs: number,
): PipelineState {
  const activeStep = toStepNumber(row.active_step);
  const nextStep =
    row.completed_step < 5
      ? ((row.completed_step + 1) as PipelineStepNumber)
      : null;
  const isStale =
    row.run_state === 'RUNNING' &&
    row.started_at !== null &&
    row.started_at <= now - staleAttemptMs;

  return {
    completedStep: row.completed_step,
    activeStep,
    nextStep,
    runState: row.run_state,
    attemptId: row.attempt_id,
    startedAt:
      row.started_at === null ? null : new Date(row.started_at).toISOString(),
    error:
      row.error_code && row.error_message
        ? { code: row.error_code, message: row.error_message }
        : null,
    isStale,
  };
}

function projectStatus(state: PipelineState): ProjectStatus {
  if (state.completedStep === 5) return 'DONE';
  if (state.completedStep === 0 && state.runState === 'IDLE') return 'DRAFT';
  return 'IN_PROGRESS';
}

function toStepNumber(value: number | null): PipelineStepNumber | null {
  if (value === null) return null;
  if (value >= 1 && value <= 5) return value as PipelineStepNumber;
  throw new Error(`Invalid active pipeline step: ${value}`);
}
