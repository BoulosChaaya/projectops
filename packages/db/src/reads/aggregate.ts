// EXEC-DB-026: Aggregation Read
import type { HandshakeCapableClient } from '../connection/handshake.ts';

export interface AggregateQuery {
  readonly table: string;
  readonly operation: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  readonly column?: string;
  readonly where?: Readonly<Record<string, unknown>>;
}

export interface AggregateResult {
  readonly count: number;
  readonly value: number | null;
}

export async function aggregate(
  client: HandshakeCapableClient,
  query: AggregateQuery
): Promise<AggregateResult> {
  const col = query.column ?? '*';
  const whereObj = query.where ?? {};
  const keys = Object.keys(whereObj);
  const clauses = keys.map((k, idx) => `${k} = $${idx + 1}`).join(' AND ');
  const values = keys.map((k) => whereObj[k]);

  const sql = `SELECT COUNT(*) AS count, ${query.operation}(${col}) AS value FROM ${query.table}${
    clauses ? ` WHERE ${clauses}` : ''
  }`;
  const res = await client.query(sql, values);
  const row = res.rows[0] ?? { count: 0, value: null };
  const count = Number(row.count ?? 0);
  const value = row.value === null || row.value === undefined ? null : Number(row.value);

  return Object.freeze({ count, value });
}
