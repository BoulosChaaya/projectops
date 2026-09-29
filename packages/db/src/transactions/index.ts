// EXEC-DB-030: Transactional Consistency
import type { DatabasePool } from '../pool/index.ts';
import {
  withTransaction,
  type TransactionOptions,
  type TransactionScopedClient,
} from './boundary.ts';

export class TransactionManager {
  private readonly pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.pool = pool;
  }

  public async run<T>(
    work: (tx: TransactionScopedClient) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    return await withTransaction(this.pool, work, options);
  }
}
