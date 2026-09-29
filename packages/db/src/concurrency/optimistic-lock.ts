// EXEC-DB-035: Optimistic Locking
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { WriteConflictError } from '../writes/conflict.ts';

export interface OptimisticLockUpdate {
  readonly table: string;
  readonly id: string;
  readonly expectedVersion: number;
  readonly changes: Readonly<Record<string, unknown>>;
}

export async function OptimisticLock(
  client: HandshakeCapableClient,
  spec: OptimisticLockUpdate
): Promise<Readonly<Record<string, unknown>>> {
  const keys = Object.keys(spec.changes);
  const setClauses = keys.map((k, idx) => `${k} = $${idx + 1}`);
  setClauses.push(`version = version + 1`);

  const values = keys.map((k) => spec.changes[k]);
  const idIdx = values.length + 1;
  const verIdx = values.length + 2;

  const sql = `UPDATE ${spec.table} SET ${setClauses.join(
    ', '
  )} WHERE id = $${idIdx} AND version = $${verIdx} RETURNING *`;

  const res = await client.query(sql, [...values, spec.id, spec.expectedVersion]);
  if (!res.rows || res.rows.length === 0) {
    throw new WriteConflictError(
      `Optimistic lock conflict on ${spec.table}(id=${spec.id}, expectedVersion=${spec.expectedVersion}).`,
      'OPTIMISTIC_LOCK_CONFLICT'
    );
  }
  return Object.freeze({ ...res.rows[0] });
}
