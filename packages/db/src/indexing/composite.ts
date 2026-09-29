// EXEC-DB-054: Composite Index Design
export interface CompositeIndexDefinition {
  readonly name: string;
  readonly table: string;
  readonly equalityColumns: readonly string[];
  readonly rangeOrSortColumns: readonly string[];
}

export function buildCompositeIndexColumns(def: CompositeIndexDefinition): readonly string[] {
  if (def.equalityColumns.length === 0 && def.rangeOrSortColumns.length === 0) {
    throw new Error('CompositeIndexDefinition requires at least one column.');
  }
  // Equality predicates always precede range/sort predicates in B-Tree composite indexes
  return Object.freeze([...def.equalityColumns, ...def.rangeOrSortColumns]);
}
