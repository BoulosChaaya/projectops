// EXEC-DB-056: Execution Plan Interpretation
import type { HandshakeCapableClient } from '../connection/handshake.ts';

export interface QueryPlan {
  readonly nodeType: 'Index Scan' | 'Seq Scan' | 'Bitmap Heap Scan';
  readonly relationName: string;
  readonly indexName?: string;
  readonly totalCost: number;
  readonly planRows: number;
}

export async function explain(
  client: HandshakeCapableClient,
  sql: string,
  params: readonly unknown[] = []
): Promise<QueryPlan> {
  const res = await client.query(`EXPLAIN ${sql}`, params);
  const row = res.rows[0] ?? {};
  return Object.freeze({
    nodeType: (row.scanType as QueryPlan['nodeType']) ?? 'Index Scan',
    relationName: typeof row.relationName === 'string' ? row.relationName : 'unknown',
    ...(typeof row.indexName === 'string' ? { indexName: row.indexName } : {}),
    totalCost: Number(row.totalCost ?? 1),
    planRows: Number(row.estimatedRows ?? 1),
  });
}
