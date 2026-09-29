// EXEC-DB-020: Single-Record Write
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { translateWriteConflict } from './conflict.ts';

export type StoredRecord = Readonly<Record<string, unknown>>;

export async function insertOne(
  client: HandshakeCapableClient,
  table: string,
  record: Record<string, unknown>
): Promise<StoredRecord> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table identifier "${table}".`);
  }
  const keys = Object.keys(record);
  if (keys.length === 0) {
    throw new Error('Cannot insert an empty record.');
  }
  for (const k of keys) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(k)) {
      throw new Error(`Invalid column identifier "${k}".`);
    }
  }

  const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
  const values = keys.map((k) => record[k]);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;

  try {
    const res = await client.query(sql, values);
    return Object.freeze({ ...(res.rows[0] ?? record) });
  } catch (error) {
    translateWriteConflict(error);
  }
}
