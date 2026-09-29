// EXEC-DB-021: Bulk Write
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { insertOne, type StoredRecord } from './single.ts';

export async function insertMany(
  client: HandshakeCapableClient,
  table: string,
  records: readonly Record<string, unknown>[]
): Promise<StoredRecord[]> {
  if (records.length === 0) return [];

  await client.query('BEGIN');
  try {
    const stored: StoredRecord[] = [];
    for (const rec of records) {
      const item = await insertOne(client, table, rec);
      stored.push(item);
    }
    await client.query('COMMIT');
    return stored;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
