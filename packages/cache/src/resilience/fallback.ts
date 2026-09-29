// EXEC-CACHE-017: Cache Failure Fallback / Bypass
export async function withCacheFallback<T>(
  cacheOp: () => Promise<T | undefined>,
  originLoader: () => Promise<T>
): Promise<{ value: T; source: 'cache' | 'origin_fallback' }> {
  try {
    const cached = await cacheOp();
    if (cached !== undefined) {
      return Object.freeze({ value: cached, source: 'cache' });
    }
  } catch {
    // Degrade gracefully to authoritative origin when Redis is unreachable
  }
  const fresh = await originLoader();
  return Object.freeze({ value: fresh, source: 'origin_fallback' });
}
