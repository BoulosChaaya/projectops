// EXEC-DB-049: Query Cost Estimation
import type { HandshakeCapableClient } from '../connection/handshake.ts';

export interface QueryCost {
  readonly startupCost: number;
  readonly totalCost: number;
  readonly estimatedRows: number;
  readonly scanType: 'Index Scan' | 'Seq Scan';
}

export async function estimateQueryCost(
  client: HandshakeCapableClient,
  sql: string,
  params: readonly unknown[] = []
): Promise<QueryCost> {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT')) {
    throw new Error('estimateQueryCost refuses mutating or non-SELECT SQL statements.');
  }
  const res = await client.query(`EXPLAIN ${sql}`, params);
  const planRow = res.rows[0] ?? {};
  return Object.freeze({
    startupCost: Number(planRow.startupCost ?? 0),
    totalCost: Number(planRow.totalCost ?? 1),
    estimatedRows: Number(planRow.estimatedRows ?? 1),
    scanType: (planRow.scanType as 'Index Scan' | 'Seq Scan') ?? 'Index Scan',
  });
}
