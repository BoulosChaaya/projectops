// EXEC-FOUND-036: Concurrent Connection Handling
export interface ConnectionConcurrencyPolicy {
  readonly maxConcurrentRequests: number;
  tryAcquire(): boolean;
  release(): void;
  getActiveCount(): number;
}

export function createConnectionConcurrencyPolicy(
  maxConcurrentRequests = 100
): ConnectionConcurrencyPolicy {
  if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests <= 0) {
    throw new Error('maxConcurrentRequests must be a positive integer.');
  }
  let active = 0;

  return Object.freeze({
    maxConcurrentRequests,
    tryAcquire(): boolean {
      if (active >= maxConcurrentRequests) {
        return false;
      }
      active += 1;
      return true;
    },
    release(): void {
      if (active > 0) {
        active -= 1;
      }
    },
    getActiveCount(): number {
      return active;
    },
  });
}
