// EXEC-DB-053: Index Maintenance Cost Awareness
import type { IndexDefinition } from './index.ts';

export interface IndexMaintenanceEstimate {
  readonly indexName: string;
  readonly writeAmplificationFactor: number;
  readonly redundantWith?: string;
}

export function estimateIndexMaintenance(
  indexes: readonly IndexDefinition[]
): IndexMaintenanceEstimate[] {
  return indexes.map((idx) => {
    const prefixMatch = indexes.find(
      (other) =>
        other.name !== idx.name &&
        other.table === idx.table &&
        other.columns.length > idx.columns.length &&
        idx.columns.every((col, i) => other.columns[i] === col)
    );
    return Object.freeze({
      indexName: idx.name,
      writeAmplificationFactor: Number((1 + idx.columns.length * 0.15).toFixed(2)),
      ...(prefixMatch ? { redundantWith: prefixMatch.name } : {}),
    });
  });
}
