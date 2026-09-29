// EXEC-DB-041: Validation-at-Write-Time
import type { EntityDefinition } from '../schema/entities.ts';

export class WriteValidationError extends Error {
  public readonly code = '23502';
  public readonly column: string;

  constructor(column: string, reason: string) {
    super(`Write validation failed for column "${column}": ${reason}`);
    this.name = 'WriteValidationError';
    this.column = column;
  }
}

export function validateWrite(record: Record<string, unknown>, entity: EntityDefinition): void {
  for (const col of entity.columns) {
    const val = record[col.name];
    if ((val === undefined || val === null) && !col.nullable && !col.defaultExpression) {
      throw new WriteValidationError(col.name, 'non-nullable column cannot be null or undefined');
    }
    if (val !== undefined && val !== null) {
      if (col.type === 'integer' && (typeof val !== 'number' || !Number.isInteger(val))) {
        throw new WriteValidationError(col.name, 'expected integer value');
      }
      if ((col.type === 'text' || col.type === 'uuid') && typeof val !== 'string') {
        throw new WriteValidationError(col.name, 'expected string value');
      }
    }
  }
}
