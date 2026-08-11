import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export class BookStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  async writeBook(
    userId: string,
    projectId: string,
    bookText: string,
  ): Promise<string> {
    const projectDirectory = join(this.root, userId, projectId);
    const finalPath = join(projectDirectory, 'book.txt');
    const temporaryPath = join(
      projectDirectory,
      `book-${randomUUID()}.tmp`,
    );

    await mkdir(projectDirectory, { recursive: true });

    try {
      await writeFile(temporaryPath, bookText, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, finalPath);
      return relative(this.root, finalPath);
    } catch (error) {
      await rm(projectDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async readBook(bookPath: string): Promise<string> {
    return readFile(this.resolveStoredPath(bookPath), 'utf8');
  }

  async removeBook(bookPath: string): Promise<void> {
    const absolutePath = this.resolveStoredPath(bookPath);
    await rm(dirname(absolutePath), { recursive: true, force: true });
  }

  private resolveStoredPath(bookPath: string): string {
    const absolutePath = resolve(this.root, bookPath);
    const rootPrefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;

    if (!absolutePath.startsWith(rootPrefix)) {
      throw new Error('Stored book path escapes the uploads directory');
    }

    return absolutePath;
  }
}
