// EXEC-DB-012: Pool Exhaustion Handling
export class PoolExhaustedError extends Error {
  public readonly code = 'DB_POOL_EXHAUSTED';
  public readonly maxConnections: number;
  public readonly acquireTimeoutMs: number;

  constructor(maxConnections: number, acquireTimeoutMs: number) {
    super(
      `Database connection pool exhausted (max=${maxConnections}) after waiting ${acquireTimeoutMs}ms.`
    );
    this.name = 'PoolExhaustedError';
    this.maxConnections = maxConnections;
    this.acquireTimeoutMs = acquireTimeoutMs;
  }
}
