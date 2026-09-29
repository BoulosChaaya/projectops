// EXEC-DB-059: Query Latency Thresholding
export interface SlowQueryThreshold {
  readonly thresholdMs: number;
}

export function createSlowQueryThreshold(thresholdMs = 200): SlowQueryThreshold {
  if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new Error('SlowQueryThreshold must be a positive number of milliseconds.');
  }
  return Object.freeze({ thresholdMs });
}

export function isSlowQuery(durationMs: number, threshold: SlowQueryThreshold): boolean {
  return durationMs >= threshold.thresholdMs;
}
