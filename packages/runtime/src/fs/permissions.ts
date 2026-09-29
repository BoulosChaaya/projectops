// EXEC-FOUND-028: Read/Write Permission Boundaries
import path from 'node:path';

export type FileAccessMode = 'read' | 'write';

export class FilePermissionBoundaryError extends Error {
  public readonly code = 'FS_BOUNDARY_VIOLATION';
  constructor(targetPath: string, mode: FileAccessMode) {
    super(`Filesystem ${mode} access denied outside allowed roots: ${targetPath}`);
    this.name = 'FilePermissionBoundaryError';
  }
}

export function assertPathAccess(
  targetPath: string,
  mode: FileAccessMode,
  allowedRoots: readonly string[]
): string {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new FilePermissionBoundaryError(String(targetPath), mode);
  }
  const resolvedTarget = path.resolve(targetPath);
  const permitted = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return (
      resolvedTarget === resolvedRoot ||
      resolvedTarget.startsWith(resolvedRoot + path.sep)
    );
  });

  if (!permitted) {
    throw new FilePermissionBoundaryError(resolvedTarget, mode);
  }
  return resolvedTarget;
}
