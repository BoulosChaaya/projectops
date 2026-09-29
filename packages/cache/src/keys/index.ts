// EXEC-CACHE-004: Cache Key Design
import { encodeKeySegment } from './collision.ts';

export interface CacheKeyComponents {
  readonly namespace: string;
  readonly entity: string;
  readonly id: string;
  readonly version?: number;
}

export function buildCacheKey(components: CacheKeyComponents): string {
  const ns = encodeKeySegment(components.namespace);
  const ent = encodeKeySegment(components.entity);
  const id = encodeKeySegment(components.id);
  const ver = components.version ?? 1;
  if (!Number.isInteger(ver) || ver < 1) {
    throw new Error('Cache key version must be a positive integer.');
  }
  return `uruk:${ns}:${ent}:v${ver}:${id}`;
}
