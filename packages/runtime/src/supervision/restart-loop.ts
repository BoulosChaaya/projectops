// EXEC-FOUND-026: Restart Loop Prevention
export interface RestartLoopOptions {
  windowMs?: number;
  maxRestartsInWindow?: number;
  nowMs?: number;
}

export function allowRestart(
  crashTimestampsMs: readonly number[],
  options: RestartLoopOptions = {}
): boolean {
  const windowMs = options.windowMs ?? 60_000;
  const maxRestarts = options.maxRestartsInWindow ?? 5;
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = nowMs - windowMs;

  const recentCount = crashTimestampsMs.filter((ts) => ts >= cutoff && ts <= nowMs).length;
  return recentCount < maxRestarts;
}
