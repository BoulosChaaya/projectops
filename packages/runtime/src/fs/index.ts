// EXEC-FOUND-027: Filesystem Access Layer
import fs from 'node:fs/promises';
import { assertPathAccess } from './permissions.ts';
import { createTemporaryStorage, type TemporaryStorage } from './temp.ts';

export interface FileSystemAccess {
  readText(filePath: string): Promise<string>;
  writeText(filePath: string, content: string): Promise<void>;
  temp: TemporaryStorage;
}

export function createFileSystemAccess(
  allowedRoots: readonly string[],
  tempRoot: string
): FileSystemAccess {
  return Object.freeze({
    async readText(filePath: string): Promise<string> {
      const safe = assertPathAccess(filePath, 'read', allowedRoots);
      return await fs.readFile(safe, 'utf8');
    },
    async writeText(filePath: string, content: string): Promise<void> {
      const safe = assertPathAccess(filePath, 'write', allowedRoots);
      await fs.writeFile(safe, content, 'utf8');
    },
    temp: createTemporaryStorage(tempRoot),
  });
}
