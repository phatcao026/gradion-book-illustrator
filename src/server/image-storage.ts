import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export type StoredImageMimeType = 'image/png' | 'image/jpeg';

export class ImageStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  async writePortrait(input: {
    userId: string;
    projectId: string;
    characterId: string;
    mimeType: StoredImageMimeType;
    bytes: Buffer;
  }): Promise<string> {
    return this.writeImage({
      userId: input.userId,
      projectId: input.projectId,
      directoryName: 'portraits',
      itemId: input.characterId,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
  }

  async writeChapterIllustration(input: {
    userId: string;
    projectId: string;
    chapterId: string;
    mimeType: StoredImageMimeType;
    bytes: Buffer;
  }): Promise<string> {
    return this.writeImage({
      userId: input.userId,
      projectId: input.projectId,
      directoryName: 'chapters',
      itemId: input.chapterId,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
  }

  private async writeImage(input: {
    userId: string;
    projectId: string;
    directoryName: 'portraits' | 'chapters';
    itemId: string;
    mimeType: StoredImageMimeType;
    bytes: Buffer;
  }): Promise<string> {
    const directory = join(
      this.root,
      input.userId,
      input.projectId,
      input.directoryName,
    );
    const extension = input.mimeType === 'image/png' ? 'png' : 'jpg';
    const finalPath = join(directory, `${input.itemId}.${extension}`);
    const temporaryPath = join(directory, `${input.itemId}-${randomUUID()}.tmp`);

    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, input.bytes, { flag: 'wx' });
      await rename(temporaryPath, finalPath);
      return relative(this.root, finalPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async readImage(imagePath: string): Promise<Buffer> {
    return readFile(this.resolveStoredPath(imagePath));
  }

  async removeImage(imagePath: string): Promise<void> {
    await rm(this.resolveStoredPath(imagePath), { force: true });
  }

  private resolveStoredPath(imagePath: string): string {
    const absolutePath = resolve(this.root, imagePath);
    const rootPrefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (!absolutePath.startsWith(rootPrefix)) {
      throw new Error('Stored image path escapes the uploads directory');
    }
    return absolutePath;
  }
}
