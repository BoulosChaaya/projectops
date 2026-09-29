// EXEC-CACHE-005: Key Collision Prevention
export function encodeKeySegment(segment: string): string {
  if (typeof segment !== 'string' || segment.trim() === '') {
    throw new Error('Cache key segment must be a non-empty string.');
  }
  // Percent-encode colons, slashes, and whitespace so composite segments can never collide
  return encodeURIComponent(segment.trim()).replace(/:/g, '%3A');
}

export function assertNoKeyCollision(keys: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new Error(`Cache key collision detected for key "${key}".`);
    }
    seen.add(key);
  }
}
