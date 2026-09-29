// EXEC-DB-023: Data Read Operations
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { findOne, type SingleReadQuery } from './single.ts';
import { findPage, type PaginatedQuery, type Page } from './paginated.ts';
import { aggregate, type AggregateQuery, type AggregateResult } from './aggregate.ts';

export interface ReadRepository<TRecord = Record<string, unknown>> {
  findOne(where: Record<string, unknown>): Promise<TRecord | null>;
  findPage(options: Omit<PaginatedQuery, 'table'>): Promise<Page<TRecord>>;
  aggregate(options: Omit<AggregateQuery, 'table'>): Promise<AggregateResult>;
}

export function createReadRepository<TRecord = Record<string, unknown>>(
  client: HandshakeCapableClient,
  table: string
): ReadRepository<TRecord> {
  return Object.freeze({
    findOne: (where) => findOne<TRecord>(client, { table, where }),
    findPage: (opts) => findPage<TRecord>(client, { table, ...opts }),
    aggregate: (opts) => aggregate(client, { table, ...opts }),
  });
}
