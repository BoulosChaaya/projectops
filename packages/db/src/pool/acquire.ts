// EXEC-DB-009: Connection Acquisition
import type { DatabaseConnection, RawQueryResult } from '../connection/connect.ts';
import type { DatabasePool } from './index.ts';

export interface PooledConnection {
  readonly id: string;
  readonly raw: DatabaseConnection;
  readonly inTransaction: boolean;
  setInTransaction(active: boolean): void;
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<RawQueryResult<TRow>>;
  release(): void;
}

export async function acquireConnection(pool: DatabasePool): Promise<PooledConnection> {
  return await pool.acquire();
}
