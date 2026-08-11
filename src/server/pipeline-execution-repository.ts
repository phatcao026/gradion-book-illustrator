import { randomUUID } from 'node:crypto';

import type {
  CharacterResult,
  StyleResult,
  StyleSource,
} from '../shared/contracts.js';
import type { AppDatabase } from './database.js';
import type { UploadedGeminiFile } from './gemini/gemini-gateway.js';

export interface PipelineExecutionContext {
  projectId: string;
  userId: string;
  title: string;
  bookPath: string;
  completedStep: number;
  activeStep: number | null;
  runState: string;
  attemptId: string | null;
  textModel: string | null;
  contextState: 'READY' | 'EXPIRED' | null;
  geminiFileName: string | null;
  geminiFileUri: string | null;
  geminiFileExpiresAt: string | null;
  bookInteractionId: string | null;
  styleInteractionId: string | null;
  charactersInteractionId: string | null;
  styleSource: StyleSource | null;
  styleInput: string;
  styleText: string | null;
}

interface ExecutionRow {
  id: string;
  user_id: string;
  title: string;
  book_path: string;
  completed_step: number;
  active_step: number | null;
  run_state: string;
  attempt_id: string | null;
  text_model: string | null;
  context_state: 'READY' | 'EXPIRED' | null;
  gemini_file_name: string | null;
  gemini_file_uri: string | null;
  gemini_file_expires_at: string | null;
  book_interaction_id: string | null;
  style_interaction_id: string | null;
  characters_interaction_id: string | null;
  style_source: StyleSource | null;
  style_input: string | null;
  style_text: string | null;
}

interface CharacterRow {
  id: string;
  name: string;
  prompt: string;
}

export class PipelineExecutionRepository {
  constructor(private readonly database: AppDatabase) {}

  prepareStyleAttempt(input: {
    userId: string;
    projectId: string;
    attemptId: string;
    styleInput: string;
    textModel: string;
    now: string;
  }): boolean {
    const source: StyleSource = input.styleInput ? 'USER' : 'GENERATED';
    const result = this.database
      .prepare(`
        INSERT INTO project_ai_contexts (
          project_id, text_model, context_state, style_source,
          style_input, updated_at
        )
        SELECT ?, ?, 'READY', ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM projects
          WHERE id = ? AND user_id = ? AND run_state = 'RUNNING'
            AND active_step = 1 AND attempt_id = ?
        )
        ON CONFLICT (project_id) DO UPDATE SET
          text_model = excluded.text_model,
          style_source = excluded.style_source,
          style_input = excluded.style_input,
          updated_at = excluded.updated_at
      `)
      .run(
        input.projectId,
        input.textModel,
        source,
        input.styleInput,
        input.now,
        input.projectId,
        input.userId,
        input.attemptId,
      );
    return Number(result.changes) === 1;
  }

  getContext(userId: string, projectId: string): PipelineExecutionContext | null {
    const row = this.database
      .prepare(`
        SELECT projects.id, projects.user_id, projects.title, projects.book_path,
               projects.completed_step, projects.active_step,
               projects.run_state, projects.attempt_id,
               context.text_model, context.context_state,
               context.gemini_file_name, context.gemini_file_uri,
               context.gemini_file_expires_at, context.book_interaction_id,
               context.style_interaction_id,
               context.characters_interaction_id, context.style_source,
               context.style_input, context.style_text
        FROM projects
        LEFT JOIN project_ai_contexts AS context
          ON context.project_id = projects.id
        WHERE projects.id = ? AND projects.user_id = ?
      `)
      .get(projectId, userId) as unknown as ExecutionRow | undefined;

    return row ? mapExecutionRow(row) : null;
  }

  getOutputs(userId: string, projectId: string): {
    styleInput: string;
    style: StyleResult | null;
    characters: CharacterResult[];
  } {
    const context = this.getContext(userId, projectId);
    if (!context) {
      return { styleInput: '', style: null, characters: [] };
    }

    const rows = this.database
      .prepare(`
        SELECT characters.id, characters.name, characters.prompt
        FROM characters
        JOIN projects ON projects.id = characters.project_id
        WHERE characters.project_id = ? AND projects.user_id = ?
        ORDER BY characters.ordinal ASC
      `)
      .all(projectId, userId) as unknown as CharacterRow[];

    return {
      styleInput: context.styleInput,
      style:
        context.styleSource && context.styleText
          ? { source: context.styleSource, text: context.styleText }
          : null,
      characters: rows,
    };
  }

  persistUploadedFile(input: AttemptInput & { file: UploadedGeminiFile }): boolean {
    return this.updateForAttempt(
      `
        UPDATE project_ai_contexts
        SET gemini_file_name = ?, gemini_file_uri = ?,
            gemini_file_expires_at = ?, context_state = 'READY', updated_at = ?
        WHERE project_id = ? AND EXISTS (
          SELECT 1 FROM projects
          WHERE id = project_ai_contexts.project_id AND user_id = ?
            AND run_state = 'RUNNING' AND active_step = ? AND attempt_id = ?
        )
      `,
      [
        input.file.name,
        input.file.uri,
        input.file.expiresAt,
        input.now,
        input.projectId,
        input.userId,
        input.step,
        input.attemptId,
      ],
    );
  }

  persistBookInteraction(
    input: AttemptInput & { interactionId: string },
  ): boolean {
    return this.updateContextId(input, 'book_interaction_id');
  }

  persistRehydratedStyleInteraction(
    input: AttemptInput & { interactionId: string },
  ): boolean {
    return this.updateContextId(input, 'style_interaction_id');
  }

  resetExpiredContext(input: AttemptInput): boolean {
    return this.updateForAttempt(
      `
        UPDATE project_ai_contexts
        SET context_state = 'READY', gemini_file_name = NULL,
            gemini_file_uri = NULL, gemini_file_expires_at = NULL,
            book_interaction_id = NULL, style_interaction_id = NULL,
            characters_interaction_id = NULL, updated_at = ?
        WHERE project_id = ? AND context_state = 'EXPIRED' AND EXISTS (
          SELECT 1 FROM projects
          WHERE id = project_ai_contexts.project_id AND user_id = ?
            AND run_state = 'RUNNING' AND active_step = ? AND attempt_id = ?
        )
      `,
      [input.now, input.projectId, input.userId, input.step, input.attemptId],
    );
  }

  markContextExpired(input: AttemptInput): boolean {
    return this.updateForAttempt(
      `
        UPDATE project_ai_contexts
        SET context_state = 'EXPIRED', updated_at = ?
        WHERE project_id = ? AND EXISTS (
          SELECT 1 FROM projects
          WHERE id = project_ai_contexts.project_id AND user_id = ?
            AND run_state = 'RUNNING' AND active_step = ? AND attempt_id = ?
        )
      `,
      [input.now, input.projectId, input.userId, input.step, input.attemptId],
    );
  }

  completeStyle(input: AttemptInput & {
    interactionId: string;
    source: StyleSource;
    styleText: string;
  }): boolean {
    return this.inTransaction(() => {
      if (!this.ownsAttempt(input)) return false;

      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET style_interaction_id = ?, style_source = ?, style_text = ?,
              context_state = 'READY', updated_at = ?
          WHERE project_id = ?
        `)
        .run(
          input.interactionId,
          input.source,
          input.styleText,
          input.now,
          input.projectId,
        );

      return this.completeProjectAttempt(input);
    });
  }

  completeCharacters(input: AttemptInput & {
    interactionId: string;
    characters: Array<{ name: string; prompt: string }>;
  }): boolean {
    return this.inTransaction(() => {
      if (!this.ownsAttempt(input)) return false;

      this.database
        .prepare('DELETE FROM characters WHERE project_id = ?')
        .run(input.projectId);
      const insert = this.database.prepare(`
        INSERT INTO characters (
          id, project_id, ordinal, name, prompt, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      input.characters.forEach((character, ordinal) => {
        insert.run(
          randomUUID(),
          input.projectId,
          ordinal,
          character.name,
          character.prompt,
          input.now,
        );
      });
      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET characters_interaction_id = ?, context_state = 'READY',
              updated_at = ?
          WHERE project_id = ?
        `)
        .run(input.interactionId, input.now, input.projectId);

      return this.completeProjectAttempt(input);
    });
  }

  private updateContextId(
    input: AttemptInput & { interactionId: string },
    column: 'book_interaction_id' | 'style_interaction_id',
  ): boolean {
    return this.updateForAttempt(
      `
        UPDATE project_ai_contexts
        SET ${column} = ?, context_state = 'READY', updated_at = ?
        WHERE project_id = ? AND EXISTS (
          SELECT 1 FROM projects
          WHERE id = project_ai_contexts.project_id AND user_id = ?
            AND run_state = 'RUNNING' AND active_step = ? AND attempt_id = ?
        )
      `,
      [
        input.interactionId,
        input.now,
        input.projectId,
        input.userId,
        input.step,
        input.attemptId,
      ],
    );
  }

  private ownsAttempt(input: AttemptInput): boolean {
    return Boolean(
      this.database
        .prepare(`
          SELECT 1 FROM projects
          WHERE id = ? AND user_id = ? AND run_state = 'RUNNING'
            AND active_step = ? AND attempt_id = ?
        `)
        .get(input.projectId, input.userId, input.step, input.attemptId),
    );
  }

  private completeProjectAttempt(input: AttemptInput): boolean {
    const result = this.database
      .prepare(`
        UPDATE projects
        SET completed_step = active_step, active_step = NULL,
            run_state = 'IDLE', attempt_id = NULL, started_at = NULL,
            error_code = NULL, error_message = NULL
        WHERE id = ? AND user_id = ? AND run_state = 'RUNNING'
          AND active_step = ? AND attempt_id = ?
      `)
      .run(input.projectId, input.userId, input.step, input.attemptId);
    return Number(result.changes) === 1;
  }

  private updateForAttempt(sql: string, parameters: SqlValue[]): boolean {
    const result = this.database.prepare(sql).run(...parameters);
    return Number(result.changes) === 1;
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

interface AttemptInput {
  userId: string;
  projectId: string;
  step: 1 | 2;
  attemptId: string;
  now: string;
}

type SqlValue = string | number | null;

function mapExecutionRow(row: ExecutionRow): PipelineExecutionContext {
  return {
    projectId: row.id,
    userId: row.user_id,
    title: row.title,
    bookPath: row.book_path,
    completedStep: row.completed_step,
    activeStep: row.active_step,
    runState: row.run_state,
    attemptId: row.attempt_id,
    textModel: row.text_model,
    contextState: row.context_state,
    geminiFileName: row.gemini_file_name,
    geminiFileUri: row.gemini_file_uri,
    geminiFileExpiresAt: row.gemini_file_expires_at,
    bookInteractionId: row.book_interaction_id,
    styleInteractionId: row.style_interaction_id,
    charactersInteractionId: row.characters_interaction_id,
    styleSource: row.style_source,
    styleInput: row.style_input ?? '',
    styleText: row.style_text,
  };
}
