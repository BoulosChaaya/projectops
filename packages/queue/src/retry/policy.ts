// Bounded Retry Policy Evaluation
import { classifyJobFailure } from './classify.ts';
import { computeExponentialBackoff, type BackoffConfig } from './backoff.ts';
import { applyBackoffJitter } from './jitter.ts';

export interface RetryDecision {
  readonly action: 'retry' | 'dead_letter';
  readonly nextDelayMs: number;
  readonly category: 'transient' | 'permanent' | 'poison_pill';
}

export function evaluateRetryPolicy(
  error: unknown,
  attemptsMade: number,
  maxAttempts: number,
  backoffConfig?: BackoffConfig,
  randomFn?: () => number
): RetryDecision {
  const classified = classifyJobFailure(error);
  if (!classified.retryable || attemptsMade >= maxAttempts) {
    return Object.freeze({
      action: 'dead_letter',
      nextDelayMs: 0,
      category: classified.category,
    });
  }

  const rawBackoff = computeExponentialBackoff(attemptsMade, backoffConfig);
  const jittered = applyBackoffJitter(rawBackoff, randomFn);
  return Object.freeze({
    action: 'retry',
    nextDelayMs: jittered,
    category: classified.category,
  });
}
