// EXEC-DB-014: Query Deadline & Cancellation
import type { DatabasePool } from '../pool/index.ts';
import type { RawQueryResult } from '../connection/connect.ts';

export class QueryDeadlineError extends Error {
  public readonly code = '57014'; // query_canceled
  public readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(`Query cancelled after exceeding deadline of ${deadlineMs}ms.`);
    this.name = 'QueryDeadlineError';
    this.deadlineMs = deadlineMs;
  }
}

export async function queryDeadlineCancellation<TRow = Record<string, unknown>>(
  pool: DatabasePool,
  sql: string,
  params: readonly unknown[],
  deadlineMs: number
): Promise<RawQueryResult<TRow>> {
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) {
    throw new Error('deadlineMs must be a positive integer.');
  }

  const conn = await pool.acquire();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      conn.setInTransaction(true); // Ensure rollback/cleanup on release
      reject(new QueryDeadlineError(deadlineMs));
    }, deadlineMs);
  });

  try {
    const result = await Promise.race([conn.query<TRow>(sql, params), timeoutPromise]);
    if (timedOut) {
      throw new QueryDeadlineError(deadlineMs);
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    conn.release();
  }
}
