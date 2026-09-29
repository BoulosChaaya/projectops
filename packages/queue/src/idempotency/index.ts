// Idempotent Job Side-Effect Guard
export type IdempotencyStatus = 'in_progress' | 'completed';

export class IdempotencyStore {
  private readonly records = new Map<
    string,
    { status: IdempotencyStatus; result?: unknown; updatedAtMs: number }
  >();

  public tryAcquire(
    idempotencyKey: string,
    nowMs: number = Date.now()
  ): { acquired: boolean; alreadyCompleted: boolean; cachedResult?: unknown } {
    const existing = this.records.get(idempotencyKey);
    if (!existing) {
      this.records.set(idempotencyKey, { status: 'in_progress', updatedAtMs: nowMs });
      return Object.freeze({ acquired: true, alreadyCompleted: false });
    }
    if (existing.status === 'completed') {
      return Object.freeze({
        acquired: false,
        alreadyCompleted: true,
        cachedResult: existing.result,
      });
    }
    return Object.freeze({ acquired: false, alreadyCompleted: false });
  }

  public markCompleted(idempotencyKey: string, result?: unknown, nowMs: number = Date.now()): void {
    this.records.set(idempotencyKey, {
      status: 'completed',
      result,
      updatedAtMs: nowMs,
    });
  }

  public releaseOnFailure(idempotencyKey: string): void {
    const existing = this.records.get(idempotencyKey);
    if (existing && existing.status === 'in_progress') {
      this.records.delete(idempotencyKey);
    }
  }
}
