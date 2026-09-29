// EXEC-DB-015: Schema Definition
import type { EntityDefinition } from './entities.ts';
import type { RelationshipDefinition } from './relationships.ts';
import type { ConstraintDefinition } from './constraints.ts';

export interface SchemaDefinition {
  readonly version: string;
  readonly entities: readonly EntityDefinition[];
  readonly relationships: readonly RelationshipDefinition[];
  readonly constraints: readonly ConstraintDefinition[];
}

export function compileSchemaDdl(schema: SchemaDefinition): string[] {
  const statements: string[] = [];
  for (const entity of schema.entities) {
    const colLines = entity.columns.map((col) => {
      const parts = [col.name, col.type.toUpperCase()];
      if (col.primaryKey) parts.push('PRIMARY KEY');
      if (!col.nullable && !col.primaryKey) parts.push('NOT NULL');
      if (col.defaultExpression) parts.push(`DEFAULT ${col.defaultExpression}`);
      return parts.join(' ');
    });
    statements.push(`CREATE TABLE ${entity.tableName} (${colLines.join(', ')});`);
  }
  return statements;
}

export function detectSchemaDrift(
  expected: SchemaDefinition,
  actualTables: readonly string[]
): string[] {
  const drift: string[] = [];
  for (const entity of expected.entities) {
    if (!actualTables.includes(entity.tableName)) {
      drift.push(`Missing expected table: ${entity.tableName}`);
    }
  }
  return drift;
}
