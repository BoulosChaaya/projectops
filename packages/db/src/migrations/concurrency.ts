// EXEC-DB-043: Migration Concurrency Control
export class MigrationLockMutex {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  public async withAdvisoryLock<T>(
    work: () => Promise<T>,
    policy: 'wait' | 'fail_fast' = 'wait'
  ): Promise<T> {
    if (this.locked) {
      if (policy === 'fail_fast') {
        throw new Error('Migration advisory lock is already held by another runner.');
      }
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.locked = true;
    try {
      return await work();
    } finally {
      this.locked = false;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export const migrationConcurrencyControl = new MigrationLockMutex();
