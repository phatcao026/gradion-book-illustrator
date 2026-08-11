import type { AppDatabase } from './database.js';
import type {
  ProjectSummary,
  SessionUser,
} from '../shared/contracts.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
}

interface ProjectRow {
  id: string;
  title: string;
  book_path: string;
  created_at: string;
}

export class AppRepository {
  constructor(private readonly database: AppDatabase) {}

  upsertUser(user: SessionUser, createdAt: string): SessionUser {
    this.database
      .prepare(`
        INSERT INTO users (id, name, email, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (email) DO UPDATE SET name = excluded.name
      `)
      .run(user.id, user.name, user.email, createdAt);

    return this.database
      .prepare('SELECT id, name, email FROM users WHERE email = ?')
      .get(user.email) as unknown as UserRow;
  }

  createSession(
    tokenHash: string,
    userId: string,
    createdAt: string,
    expiresAt: number,
  ): void {
    this.database
      .prepare(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(tokenHash, userId, createdAt, expiresAt);
  }

  findSessionUser(tokenHash: string, now: number): SessionUser | null {
    const row = this.database
      .prepare(`
        SELECT users.id, users.name, users.email
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `)
      .get(tokenHash, now) as unknown as UserRow | undefined;

    if (!row) {
      this.deleteSession(tokenHash);
      return null;
    }

    return row;
  }

  deleteSession(tokenHash: string): void {
    this.database
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .run(tokenHash);
  }

  createProject(input: {
    id: string;
    userId: string;
    title: string;
    bookPath: string;
    createdAt: string;
  }): ProjectSummary {
    this.database
      .prepare(`
        INSERT INTO projects (id, user_id, title, book_path, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.userId,
        input.title,
        input.bookPath,
        input.createdAt,
      );

    return toProjectSummary({
      id: input.id,
      title: input.title,
      book_path: input.bookPath,
      created_at: input.createdAt,
    });
  }

  listProjects(userId: string): ProjectSummary[] {
    const rows = this.database
      .prepare(`
        SELECT id, title, book_path, created_at
        FROM projects
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(userId) as unknown as ProjectRow[];

    return rows.map(toProjectSummary);
  }

  findProject(userId: string, projectId: string): ProjectRow | null {
    return (
      (this.database
        .prepare(`
          SELECT id, title, book_path, created_at
          FROM projects
          WHERE user_id = ? AND id = ?
        `)
        .get(userId, projectId) as unknown as ProjectRow | undefined) ?? null
    );
  }
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    status: 'DRAFT',
    completedSteps: 0,
  };
}
