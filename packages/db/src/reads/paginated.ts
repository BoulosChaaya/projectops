// EXEC-DB-025: Filtered/Paginated Read
import type { HandshakeCapableClient } from '../connection/handshake.ts';

export interface PaginatedQuery {
  readonly table: string;
  readonly where?: Readonly<Record<string, unknown>>;
  readonly orderBy: string;
  readonly tieBreakerColumn?: string;
  readonly limit: number;
  readonly offset?: number;
}

export interface Page<TRecord> {
  readonly items: readonly TRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export async function findPage<TRecord = Record<string, unknown>>(
  client: HandshakeCapableClient,
  query: PaginatedQuery
): Promise<Page<TRecord>> {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) {
    throw new Error('Pagination limit must be an integer between 1 and 200.');
  }
  const offset = query.offset ?? 0;
  const tieBreaker = query.tieBreakerColumn ?? 'id';
  const whereObj = query.where ?? {};
  const keys = Object.keys(whereObj);
  const clauses = keys.map((k, idx) => `${k} = $${idx + 1}`).join(' AND ');
  const values = keys.map((k) => whereObj[k]);

  const limitParamIdx = values.length + 1;
  const offsetParamIdx = values.length + 2;
  const sql = `SELECT * FROM ${query.table}${
    clauses ? ` WHERE ${clauses}` : ''
  } ORDER BY ${query.orderBy} ASC, ${tieBreaker} ASC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`;

  const res = await client.query(sql, [...values, query.limit + 1, offset]);
  const hasMore = res.rows.length > query.limit;
  const items = res.rows.slice(0, query.limit).map((r) => Object.freeze({ ...r }) as TRecord);

  return Object.freeze({
    items: Object.freeze(items),
    limit: query.limit,
    offset,
    hasMore,
  });
}
