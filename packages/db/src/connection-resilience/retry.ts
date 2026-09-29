// EXEC-DB-005: Retry on Transient Failure
import { classifyConnectionFailure } from './failure.ts';

export interface TransientRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

export async function retryTransientConnection<T>(
  operation: (attempt: number) => Promise<T>,
  policy: TransientRetryPolicy = { maxAttempts: 3, baseDelayMs: 10 }
): Promise<T> {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer >= 1.');
  }

  const sleep = policy.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const baseDelay = policy.baseDelayMs ?? 10;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const classified = classifyConnectionFailure(error);
      if (!classified.transient || attempt >= policy.maxAttempts) {
        throw error;
      }
      await sleep(baseDelay * attempt);
    }
  }

  throw lastError;
}
