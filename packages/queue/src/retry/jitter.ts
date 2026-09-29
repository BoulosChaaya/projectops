// Backoff Jitter Application (Equal / Full Jitter)
export function applyBackoffJitter(
  backoffMs: number,
  randomFn: () => number = Math.random
): number {
  const factor = Math.max(0, Math.min(1, randomFn()));
  // Equal jitter: half deterministic base + half uniform random
  const half = backoffMs / 2;
  return Math.floor(half + half * factor);
}
