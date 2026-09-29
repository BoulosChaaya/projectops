// EXEC-DB-031: Transaction Boundary Definition & EXEC-DB-033: IsolationLevel
import type { DatabasePool } from '../pool/index.ts';
import type { RawQueryResult } from '../connection/connect.ts';
import { TransactionExecutionError } from './outcome.ts';

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionScopedClient {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<RawQueryResult<TRow>>;
}

export interface TransactionOptions {
  readonly isolationLevel?: IsolationLevel;
  readonly retrySafe?: boolean;
}

export async function withTransaction<T>(
  pool: DatabasePool,
  work: (txClient: TransactionScopedClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const isolation = options.isolationLevel ?? 'READ COMMITTED';
  const conn = await pool.acquire();
  let active = true;

  const scopedClient: TransactionScopedClient = Object.freeze({
    async query<TRow = Record<string, unknown>>(
      sql: string,
      params: readonly unknown[] = []
    ): Promise<RawQueryResult<TRow>> {
      if (!active) {
        throw new Error('Transaction client is no longer active after transaction completion.');
      }
      return await conn.query<TRow>(sql, params);
    },
  });

  try {
    conn.setInTransaction(true);
    await conn.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  } catch (beginErr) {
    active = false;
    conn.release();
    throw new TransactionExecutionError('Failed to begin transaction.', 'begin', false, beginErr);
  }

  let result: T;
  try {
    result = await work(scopedClient);
  } catch (workErr) {
    active = false;
    try {
      await conn.query('ROLLBACK');
      conn.setInTransaction(false);
    } catch (rbErr) {
      conn.release();
      throw new TransactionExecutionError(
        'Transaction work failed and ROLLBACK also failed.',
        'rollback',
        false,
        rbErr
      );
    }
    conn.release();
    throw workErr;
  }

  active = false;
  try {
    await conn.query('COMMIT');
    conn.setInTransaction(false);
    conn.release();
    return result;
  } catch (commitErr) {
    conn.release();
    throw new TransactionExecutionError('Transaction COMMIT failed.', 'commit', false, commitErr);
  }
}
