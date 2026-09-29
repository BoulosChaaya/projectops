// EXEC-CACHE-002: Cache Hit Handling
import { deserializeCacheValue, type CacheEnvelope } from '../serialization/index.ts';

export interface CacheHitResult<T> {
  readonly status: 'hit' | 'negative_hit' | 'corrupt_miss';
  readonly value: T | null;
  readonly storedAtMs?: number;
}

export function handleCacheHit<T>(
  rawPayload: string,
  expectedSchemaVersion = 1
): CacheHitResult<T> {
  const envelope: CacheEnvelope<T> | null = deserializeCacheValue<T>(
    rawPayload,
    expectedSchemaVersion
  );
  if (!envelope) {
    return Object.freeze({ status: 'corrupt_miss', value: null });
  }
  if (envelope.negativeSentinel) {
    return Object.freeze({
      status: 'negative_hit',
      value: null,
      storedAtMs: envelope.storedAtMs,
    });
  }
  return Object.freeze({
    status: 'hit',
    value: envelope.payload,
    storedAtMs: envelope.storedAtMs,
  });
}
