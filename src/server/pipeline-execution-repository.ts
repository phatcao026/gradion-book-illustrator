import { randomUUID } from 'node:crypto';

import type {
  ChapterResult,
  CharacterResult,
  IllustrationStatus,
  PortraitStatus,
  StyleResult,
  StyleSource,
} from '../shared/contracts.js';
import type { AppDatabase } from './database.js';
import type { UploadedGeminiFile } from './gemini/gemini-gateway.js';
import type { StoredImageMimeType } from './image-storage.js';

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
  chaptersInteractionId: string | null;
  styleSource: StyleSource | null;
  styleInput: string;
  styleText: string | null;
  imageModel: string | null;
  imageContextState: 'READY' | 'EXPIRED';
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
  chapters_interaction_id: string | null;
  style_source: StyleSource | null;
  style_input: string | null;
  style_text: string | null;
  image_model: string | null;
  image_context_state: 'READY' | 'EXPIRED';
}

interface CharacterRow {
  id: string;
  name: string;
  prompt: string;
  portrait_status: PortraitStatus | null;
  image_path: string | null;
  mime_type: StoredImageMimeType | null;
  interaction_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface ChapterRow {
  id: string;
  name: string;
  prompt: string;
  illustration_status: IllustrationStatus | null;
  image_path: string | null;
  mime_type: StoredImageMimeType | null;
  interaction_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface PortraitWorkItem {
  characterId: string;
  name: string;
  prompt: string;
  status: PortraitStatus;
  imagePath: string | null;
  mimeType: StoredImageMimeType | null;
  interactionId: string | null;
}

export interface IllustrationWorkItem {
  chapterId: string;
  name: string;
  prompt: string;
  status: IllustrationStatus;
  imagePath: string | null;
  mimeType: StoredImageMimeType | null;
  interactionId: string | null;
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

  preparePortraitAttempt(input: {
    userId: string;
    projectId: string;
    attemptId: string;
    imageModel: string;
    now: string;
  }): boolean {
    return this.inTransaction(() => {
      const attempt: AttemptInput = { ...input, step: 3 };
      if (!this.ownsAttempt(attempt)) return false;

      const existing = this.database
        .prepare(
          'SELECT image_model FROM project_ai_contexts WHERE project_id = ?',
        )
        .get(input.projectId) as unknown as { image_model: string | null } | undefined;
      if (!existing) return false;

      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET image_model = ?,
              image_context_state = CASE
                WHEN image_model IS NOT NULL AND image_model <> ?
                  THEN 'EXPIRED'
                ELSE image_context_state
              END,
              updated_at = ?
          WHERE project_id = ?
        `)
        .run(input.imageModel, input.imageModel, input.now, input.projectId);

      const characters = this.database
        .prepare('SELECT id FROM characters WHERE project_id = ? ORDER BY ordinal')
        .all(input.projectId) as unknown as Array<{ id: string }>;
      const prepare = this.database.prepare(`
        INSERT INTO character_portraits (
          character_id, status, updated_at
        ) VALUES (?, 'QUEUED', ?)
        ON CONFLICT (character_id) DO UPDATE SET
          status = CASE
            WHEN character_portraits.status = 'COMPLETED' THEN 'COMPLETED'
            ELSE 'QUEUED'
          END,
          error_code = CASE
            WHEN character_portraits.status = 'COMPLETED'
              THEN character_portraits.error_code
            ELSE NULL
          END,
          error_message = CASE
            WHEN character_portraits.status = 'COMPLETED'
              THEN character_portraits.error_message
            ELSE NULL
          END,
          updated_at = excluded.updated_at
      `);
      characters.forEach((character) => prepare.run(character.id, input.now));
      return true;
    });
  }

  prepareIllustrationAttempt(input: {
    userId: string;
    projectId: string;
    attemptId: string;
    imageModel: string;
    now: string;
  }): boolean {
    return this.inTransaction(() => {
      const attempt: AttemptInput = { ...input, step: 5 };
      if (!this.ownsAttempt(attempt)) return false;

      const context = this.database
        .prepare(
          'SELECT image_model FROM project_ai_contexts WHERE project_id = ?',
        )
        .get(input.projectId) as unknown as { image_model: string | null } | undefined;
      const chapter = this.database
        .prepare('SELECT id FROM chapters WHERE project_id = ?')
        .get(input.projectId) as unknown as { id: string } | undefined;
      if (!context || !chapter) return false;

      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET image_model = ?,
              image_context_state = CASE
                WHEN image_model IS NOT NULL AND image_model <> ?
                  THEN 'EXPIRED'
                ELSE image_context_state
              END,
              updated_at = ?
          WHERE project_id = ?
        `)
        .run(input.imageModel, input.imageModel, input.now, input.projectId);

      this.database
        .prepare(`
          INSERT INTO chapter_illustrations (
            chapter_id, status, updated_at
          ) VALUES (?, 'QUEUED', ?)
          ON CONFLICT (chapter_id) DO UPDATE SET
            status = CASE
              WHEN chapter_illustrations.status = 'COMPLETED'
                THEN 'COMPLETED'
              ELSE 'QUEUED'
            END,
            error_code = CASE
              WHEN chapter_illustrations.status = 'COMPLETED'
                THEN chapter_illustrations.error_code
              ELSE NULL
            END,
            error_message = CASE
              WHEN chapter_illustrations.status = 'COMPLETED'
                THEN chapter_illustrations.error_message
              ELSE NULL
            END,
            updated_at = excluded.updated_at
        `)
        .run(chapter.id, input.now);
      return true;
    });
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
               context.characters_interaction_id,
               context.chapters_interaction_id, context.style_source,
               context.style_input, context.style_text,
               context.image_model, context.image_context_state
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
    chapters: ChapterResult[];
  } {
    const context = this.getContext(userId, projectId);
    if (!context) {
      return { styleInput: '', style: null, characters: [], chapters: [] };
    }

    const rows = this.database
      .prepare(`
        SELECT characters.id, characters.name, characters.prompt,
               portraits.status AS portrait_status, portraits.image_path,
               portraits.mime_type, portraits.interaction_id,
               portraits.error_code, portraits.error_message
        FROM characters
        JOIN projects ON projects.id = characters.project_id
        LEFT JOIN character_portraits AS portraits
          ON portraits.character_id = characters.id
        WHERE characters.project_id = ? AND projects.user_id = ?
        ORDER BY characters.ordinal ASC
      `)
      .all(projectId, userId) as unknown as CharacterRow[];

    const chapterRows = this.database
      .prepare(`
        SELECT chapters.id, chapters.name, chapters.prompt,
               illustrations.status AS illustration_status,
               illustrations.image_path, illustrations.mime_type,
               illustrations.interaction_id, illustrations.error_code,
               illustrations.error_message
        FROM chapters
        JOIN projects ON projects.id = chapters.project_id
        LEFT JOIN chapter_illustrations AS illustrations
          ON illustrations.chapter_id = chapters.id
        WHERE chapters.project_id = ? AND projects.user_id = ?
      `)
      .all(projectId, userId) as unknown as ChapterRow[];

    return {
      styleInput: context.styleInput,
      style:
        context.styleSource && context.styleText
          ? { source: context.styleSource, text: context.styleText }
          : null,
      characters: rows.map((row) => ({
        id: row.id,
        name: row.name,
        prompt: row.prompt,
        portrait: row.portrait_status
          ? {
              status: row.portrait_status,
              imageUrl:
                row.portrait_status === 'COMPLETED'
                  ? `/api/projects/${encodeURIComponent(projectId)}/characters/${encodeURIComponent(row.id)}/portrait`
                  : null,
              mimeType: row.mime_type,
              error:
                row.error_code && row.error_message
                  ? { code: row.error_code, message: row.error_message }
                  : null,
            }
          : null,
      })),
      chapters: chapterRows.map((row) => ({
        id: row.id,
        name: row.name,
        prompt: row.prompt,
        illustration: row.illustration_status
          ? {
              status: row.illustration_status,
              imageUrl:
                row.illustration_status === 'COMPLETED'
                  ? `/api/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(row.id)}/illustration`
                  : null,
              mimeType: row.mime_type,
              error:
                row.error_code && row.error_message
                  ? { code: row.error_code, message: row.error_message }
                  : null,
            }
          : null,
      })),
    };
  }

  listCharacterPrompts(
    userId: string,
    projectId: string,
  ): Array<{ name: string; prompt: string }> {
    return this.database
      .prepare(`
        SELECT characters.name, characters.prompt
        FROM characters
        JOIN projects ON projects.id = characters.project_id
        WHERE characters.project_id = ? AND projects.user_id = ?
        ORDER BY characters.ordinal
      `)
      .all(projectId, userId) as unknown as Array<{
      name: string;
      prompt: string;
    }>;
  }

  completeChapters(input: AttemptInput & {
    interactionId: string;
    chapter: { name: string; prompt: string };
  }): boolean {
    return this.inTransaction(() => {
      if (!this.ownsAttempt(input)) return false;

      this.database
        .prepare('DELETE FROM chapters WHERE project_id = ?')
        .run(input.projectId);
      this.database
        .prepare(`
          INSERT INTO chapters (id, project_id, name, prompt, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          input.projectId,
          input.chapter.name,
          input.chapter.prompt,
          input.now,
        );
      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET chapters_interaction_id = ?, context_state = 'READY',
              updated_at = ?
          WHERE project_id = ?
        `)
        .run(input.interactionId, input.now, input.projectId);

      return this.completeProjectAttempt(input);
    });
  }

  getIllustrationWork(
    userId: string,
    projectId: string,
  ): IllustrationWorkItem | null {
    const row = this.database
      .prepare(`
        SELECT chapters.id, chapters.name, chapters.prompt,
               illustrations.status AS illustration_status,
               illustrations.image_path, illustrations.mime_type,
               illustrations.interaction_id, illustrations.error_code,
               illustrations.error_message
        FROM chapters
        JOIN projects ON projects.id = chapters.project_id
        JOIN chapter_illustrations AS illustrations
          ON illustrations.chapter_id = chapters.id
        WHERE chapters.project_id = ? AND projects.user_id = ?
      `)
      .get(projectId, userId) as unknown as ChapterRow | undefined;
    return row
      ? {
          chapterId: row.id,
          name: row.name,
          prompt: row.prompt,
          status: requiredIllustrationStatus(row.illustration_status),
          imagePath: row.image_path,
          mimeType: row.mime_type,
          interactionId: row.interaction_id,
        }
      : null;
  }

  markIllustrationGenerating(
    input: AttemptInput & { chapterId: string },
  ): boolean {
    return this.updateForAttempt(
      `
        UPDATE chapter_illustrations
        SET status = 'GENERATING', error_code = NULL, error_message = NULL,
            updated_at = ?
        WHERE chapter_id = ? AND status <> 'COMPLETED' AND EXISTS (
          SELECT 1 FROM chapters
          JOIN projects ON projects.id = chapters.project_id
          WHERE chapters.id = chapter_illustrations.chapter_id
            AND projects.id = ? AND projects.user_id = ?
            AND projects.run_state = 'RUNNING'
            AND projects.active_step = ? AND projects.attempt_id = ?
        )
      `,
      [
        input.now,
        input.chapterId,
        input.projectId,
        input.userId,
        input.step,
        input.attemptId,
      ],
    );
  }

  completeIllustration(input: AttemptInput & {
    chapterId: string;
    imagePath: string;
    mimeType: StoredImageMimeType;
    interactionId: string;
  }): boolean {
    return this.inTransaction(() => {
      const applied = this.updateForAttempt(
        `
          UPDATE chapter_illustrations
          SET status = 'COMPLETED', image_path = ?, mime_type = ?,
              interaction_id = ?, error_code = NULL, error_message = NULL,
              updated_at = ?
          WHERE chapter_id = ? AND status = 'GENERATING' AND EXISTS (
            SELECT 1 FROM chapters
            JOIN projects ON projects.id = chapters.project_id
            WHERE chapters.id = chapter_illustrations.chapter_id
              AND projects.id = ? AND projects.user_id = ?
              AND projects.run_state = 'RUNNING'
              AND projects.active_step = ? AND projects.attempt_id = ?
          )
        `,
        [
          input.imagePath,
          input.mimeType,
          input.interactionId,
          input.now,
          input.chapterId,
          input.projectId,
          input.userId,
          input.step,
          input.attemptId,
        ],
      );
      if (!applied) return false;

      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET image_context_state = 'READY', updated_at = ?
          WHERE project_id = ?
        `)
        .run(input.now, input.projectId);
      return true;
    });
  }

  failIllustration(input: AttemptInput & {
    chapterId: string;
    error: { code: string; message: string };
  }): boolean {
    return this.updateForAttempt(
      `
        UPDATE chapter_illustrations
        SET status = 'FAILED', error_code = ?, error_message = ?, updated_at = ?
        WHERE chapter_id = ? AND status <> 'COMPLETED' AND EXISTS (
          SELECT 1 FROM chapters
          JOIN projects ON projects.id = chapters.project_id
          WHERE chapters.id = chapter_illustrations.chapter_id
            AND projects.id = ? AND projects.user_id = ?
            AND projects.run_state = 'RUNNING'
            AND projects.active_step = ? AND projects.attempt_id = ?
        )
      `,
      [
        input.error.code,
        input.error.message,
        input.now,
        input.chapterId,
        input.projectId,
        input.userId,
        input.step,
        input.attemptId,
      ],
    );
  }

  getChapterIllustration(
    userId: string,
    projectId: string,
    chapterId: string,
  ): { imagePath: string; mimeType: StoredImageMimeType } | null {
    const row = this.database
      .prepare(`
        SELECT illustrations.image_path, illustrations.mime_type
        FROM chapter_illustrations AS illustrations
        JOIN chapters ON chapters.id = illustrations.chapter_id
        JOIN projects ON projects.id = chapters.project_id
        WHERE projects.id = ? AND projects.user_id = ?
          AND chapters.id = ? AND illustrations.status = 'COMPLETED'
      `)
      .get(projectId, userId, chapterId) as unknown as
      | { image_path: string; mime_type: StoredImageMimeType }
      | undefined;
    return row
      ? { imagePath: row.image_path, mimeType: row.mime_type }
      : null;
  }

  listPortraitWork(userId: string, projectId: string): PortraitWorkItem[] {
    const rows = this.database
      .prepare(`
        SELECT characters.id, characters.name, characters.prompt,
               portraits.status AS portrait_status, portraits.image_path,
               portraits.mime_type, portraits.interaction_id,
               portraits.error_code, portraits.error_message
        FROM characters
        JOIN projects ON projects.id = characters.project_id
        JOIN character_portraits AS portraits
          ON portraits.character_id = characters.id
        WHERE characters.project_id = ? AND projects.user_id = ?
        ORDER BY characters.ordinal ASC
      `)
      .all(projectId, userId) as unknown as CharacterRow[];
    return rows.map((row) => ({
      characterId: row.id,
      name: row.name,
      prompt: row.prompt,
      status: requiredPortraitStatus(row.portrait_status),
      imagePath: row.image_path,
      mimeType: row.mime_type,
      interactionId: row.interaction_id,
    }));
  }

  markPortraitGenerating(
    input: AttemptInput & { characterId: string },
  ): boolean {
    return this.updateForAttempt(
      `
        UPDATE character_portraits
        SET status = 'GENERATING', error_code = NULL, error_message = NULL,
            updated_at = ?
        WHERE character_id = ? AND status <> 'COMPLETED' AND EXISTS (
          SELECT 1 FROM characters
          JOIN projects ON projects.id = characters.project_id
          WHERE characters.id = character_portraits.character_id
            AND projects.id = ? AND projects.user_id = ?
            AND projects.run_state = 'RUNNING'
            AND projects.active_step = ? AND projects.attempt_id = ?
        )
      `,
      [
        input.now,
        input.characterId,
        input.projectId,
        input.userId,
        input.step,
        input.attemptId,
      ],
    );
  }

  completePortrait(input: AttemptInput & {
    characterId: string;
    imagePath: string;
    mimeType: StoredImageMimeType;
    interactionId: string;
  }): boolean {
    return this.inTransaction(() => {
      const applied = this.updateForAttempt(
        `
          UPDATE character_portraits
          SET status = 'COMPLETED', image_path = ?, mime_type = ?,
              interaction_id = ?, error_code = NULL, error_message = NULL,
              updated_at = ?
          WHERE character_id = ? AND status = 'GENERATING' AND EXISTS (
            SELECT 1 FROM characters
            JOIN projects ON projects.id = characters.project_id
            WHERE characters.id = character_portraits.character_id
              AND projects.id = ? AND projects.user_id = ?
              AND projects.run_state = 'RUNNING'
              AND projects.active_step = ? AND projects.attempt_id = ?
          )
        `,
        [
          input.imagePath,
          input.mimeType,
          input.interactionId,
          input.now,
          input.characterId,
          input.projectId,
          input.userId,
          input.step,
          input.attemptId,
        ],
      );
      if (!applied) return false;

      this.database
        .prepare(`
          UPDATE project_ai_contexts
          SET image_context_state = 'READY', updated_at = ?
          WHERE project_id = ?
        `)
        .run(input.now, input.projectId);
      return true;
    });
  }

  failPortrait(input: AttemptInput & {
    characterId: string;
    error: { code: string; message: string };
  }): boolean {
    return this.updateForAttempt(
      `
        UPDATE character_portraits
        SET status = 'FAILED', error_code = ?, error_message = ?, updated_at = ?
        WHERE character_id = ? AND status <> 'COMPLETED' AND EXISTS (
          SELECT 1 FROM characters
          JOIN projects ON projects.id = characters.project_id
          WHERE characters.id = character_portraits.character_id
            AND projects.id = ? AND projects.user_id = ?
            AND projects.run_state = 'RUNNING'
            AND projects.active_step = ? AND projects.attempt_id = ?
        )
      `,
      [
        input.error.code,
        input.error.message,
        input.now,
        input.characterId,
        input.projectId,
        input.userId,
        input.step,
        input.attemptId,
      ],
    );
  }

  markImageContextExpired(input: AttemptInput): boolean {
    return this.updateForAttempt(
      `
        UPDATE project_ai_contexts
        SET image_context_state = 'EXPIRED', updated_at = ?
        WHERE project_id = ? AND EXISTS (
          SELECT 1 FROM projects
          WHERE id = project_ai_contexts.project_id AND user_id = ?
            AND run_state = 'RUNNING' AND active_step = ? AND attempt_id = ?
        )
      `,
      [input.now, input.projectId, input.userId, input.step, input.attemptId],
    );
  }

  getPortraitImage(
    userId: string,
    projectId: string,
    characterId: string,
  ): { imagePath: string; mimeType: StoredImageMimeType } | null {
    const row = this.database
      .prepare(`
        SELECT portraits.image_path, portraits.mime_type
        FROM character_portraits AS portraits
        JOIN characters ON characters.id = portraits.character_id
        JOIN projects ON projects.id = characters.project_id
        WHERE projects.id = ? AND projects.user_id = ?
          AND characters.id = ? AND portraits.status = 'COMPLETED'
      `)
      .get(projectId, userId, characterId) as unknown as
      | { image_path: string; mime_type: StoredImageMimeType }
      | undefined;
    return row
      ? { imagePath: row.image_path, mimeType: row.mime_type }
      : null;
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
            characters_interaction_id = NULL, chapters_interaction_id = NULL,
            updated_at = ?
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
  step: 1 | 2 | 3 | 4 | 5;
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
    chaptersInteractionId: row.chapters_interaction_id,
    styleSource: row.style_source,
    styleInput: row.style_input ?? '',
    styleText: row.style_text,
    imageModel: row.image_model,
    imageContextState: row.image_context_state,
  };
}

function requiredPortraitStatus(value: PortraitStatus | null): PortraitStatus {
  if (!value) throw new Error('Portrait work is missing its persisted status.');
  return value;
}

function requiredIllustrationStatus(
  value: IllustrationStatus | null,
): IllustrationStatus {
  if (!value) throw new Error('Illustration work is missing its persisted status.');
  return value;
}
