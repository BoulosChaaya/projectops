// EXEC-DB-039: Uniqueness Enforcement
export interface UniqueConstraint {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
}

export class UniqueViolationError extends Error {
  public readonly code = '23505';
  public readonly constraint: string;

  constructor(constraint: string) {
    super(`Unique constraint violation on "${constraint}".`);
    this.name = 'UniqueViolationError';
    this.constraint = constraint;
  }
}
