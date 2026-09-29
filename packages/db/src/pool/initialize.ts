// EXEC-DB-008: Pool Initialization
import { DatabasePool, type PoolConfig } from './index.ts';

export async function createPool(config: PoolConfig): Promise<DatabasePool> {
  const pool = new DatabasePool(config);
  await pool.initialize();
  return pool;
}
