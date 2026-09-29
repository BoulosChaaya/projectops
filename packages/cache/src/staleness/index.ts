// EXEC-CACHE-014: Staleness Window Enforcement
export type ResourceStalenessTier = 'tier0_zero_staleness' | 'tier1_domain' | 'tier2_catalog';

const TIER_MAX_STALENESS_MS: Readonly<Record<ResourceStalenessTier, number>> = Object.freeze({
  tier0_zero_staleness: 0,
  tier1_domain: 5_000,
  tier2_catalog: 300_000,
});

export function maxStalenessFor(tier: ResourceStalenessTier): number {
  return TIER_MAX_STALENESS_MS[tier] ?? 0;
}

export function isWithinStalenessWindow(
  storedAtMs: number,
  tier: ResourceStalenessTier,
  nowMs: number = Date.now()
): boolean {
  const maxMs = maxStalenessFor(tier);
  if (maxMs <= 0) return false;
  return nowMs - storedAtMs <= maxMs;
}
