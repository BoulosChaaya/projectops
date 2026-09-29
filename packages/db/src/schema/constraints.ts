// EXEC-DB-018: Constraint Definition
export interface ConstraintDefinition {
  readonly name: string;
  readonly tableName: string;
  readonly kind: 'PRIMARY_KEY' | 'UNIQUE' | 'CHECK' | 'FOREIGN_KEY';
  readonly columns: readonly string[];
  readonly checkExpression?: string;
}

export function defineConstraint(constraint: ConstraintDefinition): ConstraintDefinition {
  return Object.freeze({
    ...constraint,
    columns: Object.freeze([...constraint.columns]),
  });
}
