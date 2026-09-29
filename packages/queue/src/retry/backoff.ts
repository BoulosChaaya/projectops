// Exponential Backoff Calculation
export interface BackoffConfig {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export function computeExponentialBackoff(
  attempt: number,
  config: BackoffConfig = { baseDelayMs: 100, maxDelayMs: 30_000 }
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('Attempt number must be a positive integer >= 1.');
  }
  const raw = config.baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(config.maxDelayMs, raw);
}
