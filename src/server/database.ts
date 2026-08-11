import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

export function openDatabase(databasePath: string): AppDatabase {
  if (databasePath !== ':memory:') {
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);

  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const hasInitialMigration = database
    .prepare('SELECT 1 FROM schema_migrations WHERE version = 1')
    .get();

  if (!hasInitialMigration) {
    database.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
  }

  applyMigration(database, 2, `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      book_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE INDEX projects_user_created_idx
      ON projects(user_id, created_at DESC);
  `);

  applyMigration(database, 3, `
    ALTER TABLE projects
      ADD COLUMN completed_step INTEGER NOT NULL DEFAULT 0
      CHECK (completed_step BETWEEN 0 AND 5);

    ALTER TABLE projects
      ADD COLUMN active_step INTEGER
      CHECK (active_step BETWEEN 1 AND 5);

    ALTER TABLE projects
      ADD COLUMN run_state TEXT NOT NULL DEFAULT 'IDLE'
      CHECK (run_state IN ('IDLE', 'RUNNING', 'FAILED', 'INTERRUPTED'));

    ALTER TABLE projects ADD COLUMN attempt_id TEXT;
    ALTER TABLE projects ADD COLUMN started_at INTEGER;
    ALTER TABLE projects ADD COLUMN error_code TEXT;
    ALTER TABLE projects ADD COLUMN error_message TEXT;

    CREATE INDEX projects_attempt_idx ON projects(attempt_id);
  `);

  applyMigration(database, 4, `
    CREATE TABLE project_ai_contexts (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      text_model TEXT NOT NULL,
      context_state TEXT NOT NULL DEFAULT 'READY'
        CHECK (context_state IN ('READY', 'EXPIRED')),
      gemini_file_name TEXT,
      gemini_file_uri TEXT,
      gemini_file_expires_at TEXT,
      book_interaction_id TEXT,
      style_interaction_id TEXT,
      characters_interaction_id TEXT,
      style_source TEXT CHECK (style_source IN ('USER', 'GENERATED')),
      style_input TEXT NOT NULL DEFAULT '',
      style_text TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 1),
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, ordinal),
      UNIQUE (project_id, name COLLATE NOCASE)
    );

    CREATE INDEX characters_project_idx ON characters(project_id, ordinal);
  `);

  return database;
}

function applyMigration(
  database: AppDatabase,
  version: number,
  statements: string,
): void {
  const applied = database
    .prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(version);

  if (applied) {
    return;
  }

  database.exec('BEGIN IMMEDIATE');

  try {
    database.exec(statements);
    database
      .prepare('INSERT INTO schema_migrations (version) VALUES (?)')
      .run(version);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
