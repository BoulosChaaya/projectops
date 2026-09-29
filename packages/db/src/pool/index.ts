// EXEC-DB-007: Connection Pooling
import { connectDatabase, type DatabaseConfig, type DatabaseConnection } from '../connection/connect.ts';
import type { PooledConnection } from './acquire.ts';
import { PoolExhaustedError } from './exhaustion.ts';
import { validateConnection } from './validate.ts';

export interface PoolConfig extends DatabaseConfig {
  readonly min?: number;
  readonly max?: number;
  readonly acquireTimeoutMs?: number;
}

export interface PoolMetrics {
  readonly total: number;
  readonly active: number;
  readonly idle: number;
  readonly waiting: number;
  readonly closed: boolean;
}

export class DatabasePool {
  private readonly config: PoolConfig;
  private readonly min: number;
  private readonly max: number;
  private readonly acquireTimeoutMs: number;
  private readonly idleConnections: DatabaseConnection[] = [];
  private readonly allConnections = new Set<DatabaseConnection>();
  private activeCount = 0;
  private closing = false;
  private closed = false;
  private readonly waitQueue: Array<{
    resolve: (conn: DatabaseConnection) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(config: PoolConfig) {
    const min = config.min ?? 0;
    const max = config.max ?? 10;
    if (!Number.isInteger(min) || min < 0 || !Number.isInteger(max) || max < 1 || min > max) {
      throw new Error(`Invalid pool bounds: min=${min}, max=${max}.`);
    }
    this.config = config;
    this.min = min;
    this.max = max;
    this.acquireTimeoutMs = config.acquireTimeoutMs ?? 2000;
  }

  public async initialize(): Promise<void> {
    try {
      for (let i = 0; i < this.min; i += 1) {
        const conn = await connectDatabase(this.config);
        this.allConnections.add(conn);
        this.idleConnections.push(conn);
      }
    } catch (error) {
      for (const conn of this.allConnections) {
        await conn.close().catch(() => {});
      }
      this.allConnections.clear();
      this.idleConnections.length = 0;
      throw error;
    }
  }

  public getMetrics(): PoolMetrics {
    return Object.freeze({
      total: this.allConnections.size,
      active: this.activeCount,
      idle: this.idleConnections.length,
      waiting: this.waitQueue.length,
      closed: this.closed,
    });
  }

  public async acquire(): Promise<PooledConnection> {
    if (this.closing || this.closed) {
      throw new Error('Cannot acquire connection: DatabasePool is closing or closed.');
    }

    const rawConn = await this.obtainHealthyRawConnection();
    this.activeCount += 1;

    let released = false;
    let inTx = false;

    const leased: PooledConnection = Object.freeze({
      id: rawConn.id,
      raw: rawConn,
      get inTransaction() {
        return inTx;
      },
      setInTransaction(active: boolean) {
        inTx = active;
      },
      async query<TRow = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
        if (released) {
          throw new Error('Cannot query on a released pooled connection.');
        }
        return await rawConn.query<TRow>(sql, params);
      },
      release: () => {
        if (released) {
          return; // Harmless idempotent release per EXEC-DB-011
        }
        released = true;
        this.returnRawConnection(rawConn, inTx);
      },
    });

    return leased;
  }

  private async obtainHealthyRawConnection(): Promise<DatabaseConnection> {
    while (this.idleConnections.length > 0) {
      const candidate = this.idleConnections.shift()!;
      const healthy = await validateConnection(candidate);
      if (healthy) {
        return candidate;
      }
      this.allConnections.delete(candidate);
      await candidate.close().catch(() => {});
    }

    if (this.allConnections.size < this.max) {
      const created = await connectDatabase(this.config);
      this.allConnections.add(created);
      return created;
    }

    return await new Promise<DatabaseConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
        }
        reject(new PoolExhaustedError(this.max, this.acquireTimeoutMs));
      }, this.acquireTimeoutMs);

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  private returnRawConnection(rawConn: DatabaseConnection, dirtyTransaction: boolean): void {
    this.activeCount = Math.max(0, this.activeCount - 1);

    const finalizeReturn = async () => {
      if (dirtyTransaction && rawConn.isOpen()) {
        await rawConn.query('ROLLBACK').catch(() => {});
      }

      if (this.closing || this.closed || !rawConn.isOpen()) {
        this.allConnections.delete(rawConn);
        await rawConn.close().catch(() => {});
        return;
      }

      if (this.waitQueue.length > 0) {
        const waiter = this.waitQueue.shift()!;
        clearTimeout(waiter.timer);
        waiter.resolve(rawConn);
        return;
      }

      this.idleConnections.push(rawConn);
    };

    void finalizeReturn();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;

    while (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(new Error('DatabasePool shut down while waiting for connection.'));
    }

    while (this.idleConnections.length > 0) {
      const conn = this.idleConnections.shift()!;
      this.allConnections.delete(conn);
      await conn.close().catch(() => {});
    }

    for (const conn of Array.from(this.allConnections)) {
      this.allConnections.delete(conn);
      await conn.close().catch(() => {});
    }

    this.closed = true;
  }
}
