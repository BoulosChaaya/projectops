// EXEC-DB-040: Referential Integrity Enforcement
import type { ReferentialAction } from '../schema/relationships.ts';

export interface ForeignKeyConstraint {
  readonly name: string;
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly onDelete: ReferentialAction;
}

export class ForeignKeyViolationError extends Error {
  public readonly code = '23503';
  public readonly constraint: string;

  constructor(constraint: string) {
    super(`Foreign key referential integrity violation on "${constraint}".`);
    this.name = 'ForeignKeyViolationError';
    this.constraint = constraint;
  }
}
