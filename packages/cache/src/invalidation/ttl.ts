// EXEC-CACHE-009: TTL Expiration
export interface TtlPolicy {
  readonly baseTtlSeconds: number;
  readonly negativeTtlSeconds?: number;
  readonly maxTtlSeconds?: number;
}

export function resolveTtlSeconds(policy: TtlPolicy, isNegative = false): number {
  const maxTtl = policy.maxTtlSeconds ?? 86_400;
  const raw = isNegative ? (policy.negativeTtlSeconds ?? 15) : policy.baseTtlSeconds;
  if (!Number.isInteger(raw) || raw <= 0 || raw > maxTtl) {
    throw new Error(`Invalid cache TTL ${raw}s (must be 1..${maxTtl}s). Immortal keys are forbidden.`);
  }
  return raw;
}
