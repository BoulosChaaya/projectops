// EXEC-DB-027: Domain Persistence Boundary
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { insertOne } from '../writes/single.ts';
import { findOne } from '../reads/single.ts';
import { mapRow, type RowMappingSpec } from './mapping.ts';

export interface DomainPersistencePort<TDomain extends Record<string, unknown>> {
  save(record: Record<string, unknown>): Promise<Readonly<TDomain>>;
  findById(id: string): Promise<Readonly<TDomain> | null>;
}

export function createDomainPersistencePort<TDomain extends Record<string, unknown>>(
  client: HandshakeCapableClient,
  table: string,
  mapping: RowMappingSpec<TDomain>,
  idColumn = 'id'
): DomainPersistencePort<TDomain> {
  return Object.freeze({
    async save(record: Record<string, unknown>): Promise<Readonly<TDomain>> {
      const stored = await insertOne(client, table, record);
      return mapRow(stored, mapping);
    },
    async findById(id: string): Promise<Readonly<TDomain> | null> {
      const row = await findOne(client, { table, where: { [idColumn]: id } });
      return row ? mapRow(row, mapping) : null;
    },
  });
}
