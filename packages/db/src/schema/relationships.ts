// EXEC-DB-017: Relationship Modeling
export type ReferentialAction = 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';

export interface RelationshipDefinition {
  readonly name: string;
  readonly kind: 'one-to-one' | 'one-to-many' | 'many-to-many';
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}

export function defineRelationship(rel: RelationshipDefinition): RelationshipDefinition {
  return Object.freeze({ ...rel });
}
