// EXEC-FOUND-029: Temporary Storage Management
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertPathAccess } from './permissions.ts';

export interface TemporaryStorage {
  withTempFile<T>(prefix: string, work: (filePath: string) => Promise<T>): Promise<T>;
}

export function createTemporaryStorage(tempRoot: string): TemporaryStorage {
  const resolvedRoot = path.resolve(tempRoot);

  return Object.freeze({
    async withTempFile<T>(prefix: string, work: (filePath: string) => Promise<T>): Promise<T> {
      await fs.mkdir(resolvedRoot, { recursive: true });
      const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'tmp';
      const uniqueName = `${safePrefix}-${crypto.randomUUID()}.tmp`;
      const candidatePath = path.join(resolvedRoot, uniqueName);
      const verifiedPath = assertPathAccess(candidatePath, 'write', [resolvedRoot]);

      await fs.writeFile(verifiedPath, '', 'utf8');
      try {
        return await work(verifiedPath);
      } finally {
        await fs.rm(verifiedPath, { force: true });
      }
    },
  });
}
