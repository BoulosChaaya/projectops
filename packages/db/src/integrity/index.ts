// EXEC-DB-038: Data Integrity Constraints
import type { UniqueConstraint } from './uniqueness.ts';
import type { ForeignKeyConstraint } from './referential.ts';
import { validateWrite } from './write-validation.ts';

export interface IntegrityPolicy {
  readonly uniqueConstraints: readonly UniqueConstraint[];
  readonly foreignKeys: readonly ForeignKeyConstraint[];
  readonly validateWrite: typeof validateWrite;
}

export function createIntegrityPolicy(
  uniqueConstraints: readonly UniqueConstraint[] = [],
  foreignKeys: readonly ForeignKeyConstraint[] = []
): IntegrityPolicy {
  return Object.freeze({
    uniqueConstraints: Object.freeze([...uniqueConstraints]),
    foreignKeys: Object.freeze([...foreignKeys]),
    validateWrite,
  });
}
