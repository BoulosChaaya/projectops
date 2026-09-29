// EXEC-DB-006: Circuit Breaking on Persistent Failure
export type BreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly recoveryIntervalMs?: number;
  readonly clock?: () => number;
}

export class CircuitBreakerOpenError extends Error {
  public readonly code = 'DB_CIRCUIT_OPEN';
  constructor() {
    super('Database connection circuit breaker is OPEN; rejecting fast.');
    this.name = 'CircuitBreakerOpenError';
  }
}

export class ConnectionCircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs = 0;
  private readonly failureThreshold: number;
  private readonly recoveryIntervalMs: number;
  private readonly clock: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? 10_000;
    this.clock = options.clock ?? (() => Date.now());
  }

  public getState(): BreakerState {
    if (this.state === 'open' && this.clock() - this.openedAtMs >= this.recoveryIntervalMs) {
      this.state = 'half_open';
    }
    return this.state;
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.getState();
    if (current === 'open') {
      throw new CircuitBreakerOpenError();
    }

    try {
      const result = await operation();
      this.consecutiveFailures = 0;
      this.state = 'closed';
      return result;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (current === 'half_open' || this.consecutiveFailures >= this.failureThreshold) {
        this.state = 'open';
        this.openedAtMs = this.clock();
      }
      throw error;
    }
  }
}
