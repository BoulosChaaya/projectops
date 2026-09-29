// EXEC-DB-036: Pessimistic Locking
import type { TransactionScopedClient } from '../transactions/boundary.ts';

export type LockWaitMode = 'WAIT' | 'NOWAIT' | 'SKIP LOCKED';

export async function PessimisticLock<TRow = Record<string, unknown>>(
  txClient: TransactionScopedClient,
  table: string,
  id: string,
  mode: LockWaitMode = 'WAIT'
): Promise<TRow | null> {
  const suffix = mode === 'WAIT' ? 'FOR UPDATE' : `FOR UPDATE ${mode}`;
  const sql = `SELECT * FROM ${table} WHERE id = $1 ${suffix}`;
  const res = await txClient.query<TRow>(sql, [id]);
  return res.rows[0] ?? null;
}
