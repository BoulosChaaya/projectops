// EXEC-DB-016: Entity Modeling
export type SqlColumnType = 'uuid' | 'text' | 'integer' | 'bigint' | 'boolean' | 'timestamptz' | 'jsonb';

export interface ColumnDefinition {
  readonly name: string;
  readonly type: SqlColumnType;
  readonly nullable: boolean;
  readonly primaryKey?: boolean;
  readonly defaultExpression?: string;
}

export interface EntityDefinition {
  readonly tableName: string;
  readonly columns: readonly ColumnDefinition[];
}

export function defineEntity(tableName: string, columns: readonly ColumnDefinition[]): EntityDefinition {
  if (!tableName || !/^[a-z_][a-z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid SQL table name "${tableName}".`);
  }
  if (!columns.some((c) => c.primaryKey === true)) {
    throw new Error(`Entity "${tableName}" must declare at least one primaryKey column.`);
  }
  return Object.freeze({
    tableName,
    columns: Object.freeze(columns.map((c) => Object.freeze({ ...c }))),
  });
}
