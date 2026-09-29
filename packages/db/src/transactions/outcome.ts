// EXEC-DB-032: Commit/Rollback Handling
export interface TransactionOutcome<T = unknown> {
  readonly status: 'committed' | 'rolled_back';
  readonly result?: T;
  readonly error?: unknown;
}

export class TransactionExecutionError extends Error {
  public readonly phase: 'begin' | 'work' | 'commit' | 'rollback';
  public readonly rollbackSucceeded: boolean;

  constructor(
    message: string,
    phase: 'begin' | 'work' | 'commit' | 'rollback',
    rollbackSucceeded: boolean,
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'TransactionExecutionError';
    this.phase = phase;
    this.rollbackSucceeded = rollbackSucceeded;
  }
}
