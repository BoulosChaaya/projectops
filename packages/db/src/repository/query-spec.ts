// EXEC-DB-028: Query Interface Design
const ALLOWED_OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=']);

export interface FilterCriterion {
  readonly field: string;
  readonly operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
  readonly value: string | number | boolean | null;
}

export interface QuerySpec<T> {
  readonly table: string;
  readonly allowedFields: readonly (keyof T & string)[];
  readonly criteria: readonly FilterCriterion[];
}

export function compileQuerySpec<T>(spec: QuerySpec<T>): { sql: string; params: readonly unknown[] } {
  const allowedSet = new Set<string>(spec.allowedFields);
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const crit of spec.criteria) {
    if (!allowedSet.has(crit.field)) {
      throw new Error(`Unsupported query field "${crit.field}" in QuerySpec.`);
    }
    if (!ALLOWED_OPERATORS.has(crit.operator)) {
      throw new Error(`Unsupported query operator "${crit.operator}" in QuerySpec.`);
    }
    params.push(crit.value);
    clauses.push(`${crit.field} ${crit.operator} $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return Object.freeze({
    sql: `SELECT * FROM ${spec.table}${whereClause}`,
    params: Object.freeze(params),
  });
}
