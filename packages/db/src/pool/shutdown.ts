// EXEC-DB-013: Pool Shutdown
import type { DatabasePool } from './index.ts';

export async function closePool(pool: DatabasePool): Promise<void> {
  await pool.close();
}
