// EXEC-DB-019: Data Write Operations
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { insertOne, type StoredRecord } from './single.ts';
import { insertMany } from './bulk.ts';

export interface WriteRepository {
  insertOne(record: Record<string, unknown>): Promise<StoredRecord>;
  insertMany(records: readonly Record<string, unknown>[]): Promise<StoredRecord[]>;
}

export function createWriteRepository(
  client: HandshakeCapableClient,
  table: string
): WriteRepository {
  return Object.freeze({
    insertOne: (record) => insertOne(client, table, record),
    insertMany: (records) => insertMany(client, table, records),
  });
}
