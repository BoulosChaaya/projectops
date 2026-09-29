// EXEC-DB-011: Connection Release
import type { PooledConnection } from './acquire.ts';

export function releaseConnection(connection: PooledConnection): void {
  connection.release();
}
