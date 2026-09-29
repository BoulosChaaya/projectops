// EXEC-DB-024: Single-Record Read
import type { HandshakeCapableClient } from '../connection/handshake.ts';

export interface SingleReadQuery {
  readonly table: string;
  readonly where: Readonly<Record<string, unknown>>;
}

export async function findOne<TRecord = Record<string, unknown>>(
  client: HandshakeCapableClient,
  query: SingleReadQuery
): Promise<TRecord | null> {
  const keys = Object.keys(query.where);
  const clauses = keys.map((k, idx) => `${k} = $${idx + 1}`).join(' AND ');
  const values = keys.map((k) => query.where[k]);
  const sql = `SELECT * FROM ${query.table}${clauses ? ` WHERE ${clauses}` : ''} LIMIT 1`;

  const res = await client.query(sql, values);
  if (!res.rows || res.rows.length === 0) {
    return null;
  }
  return Object.freeze({ ...res.rows[0] }) as TRecord;
}
