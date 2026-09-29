// EXEC-DB-051: Indexing
export interface IndexDefinition {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique?: boolean;
}

export function compileIndexDdl(def: IndexDefinition): string {
  const uniqueSql = def.unique ? 'UNIQUE ' : '';
  return `CREATE ${uniqueSql}INDEX ${def.name} ON ${def.table} (${def.columns.join(', ')});`;
}
