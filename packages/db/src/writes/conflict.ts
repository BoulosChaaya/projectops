// EXEC-DB-022: Write Conflict Detection
export class WriteConflictError extends Error {
  public readonly code: string;
  public readonly constraint?: string;

  constructor(message: string, code = '23505', constraint?: string) {
    super(message);
    this.name = 'WriteConflictError';
    this.code = code;
    this.constraint = constraint;
  }
}

export function translateWriteConflict(error: unknown): never {
  const code = (error as { code?: string })?.code;
  const constraint = (error as { constraint?: string })?.constraint;

  if (code === '23505' || code === '40001' || code === 'OPTIMISTIC_LOCK_CONFLICT') {
    throw new WriteConflictError(
      `Write conflict detected (${code}).`,
      code,
      constraint
    );
  }
  throw error;
}
