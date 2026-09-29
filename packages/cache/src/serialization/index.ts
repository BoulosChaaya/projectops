// EXEC-CACHE-006: Serialization/Deserialization Consistency
import crypto from 'node:crypto';

export interface CacheEnvelope<T = unknown> {
  readonly schemaVersion: number;
  readonly negativeSentinel: boolean;
  readonly storedAtMs: number;
  readonly checksum: string;
  readonly payload: T | null;
}

function computeChecksum(payloadJson: string, schemaVersion: number, negative: boolean): string {
  return crypto
    .createHash('sha256')
    .update(`${schemaVersion}:${negative}:${payloadJson}`, 'utf8')
    .digest('hex');
}

export function serializeCacheValue<T>(
  value: T | null,
  options: { schemaVersion?: number; negativeSentinel?: boolean; nowMs?: number } = {}
): string {
  const schemaVersion = options.schemaVersion ?? 1;
  const negativeSentinel = options.negativeSentinel === true;
  const storedAtMs = options.nowMs ?? Date.now();
  const payload = negativeSentinel ? null : value;
  const payloadJson = JSON.stringify(payload);
  const checksum = computeChecksum(payloadJson, schemaVersion, negativeSentinel);

  const envelope: CacheEnvelope<T> = {
    schemaVersion,
    negativeSentinel,
    storedAtMs,
    checksum,
    payload,
  };
  return JSON.stringify(envelope);
}

export function deserializeCacheValue<T>(
  raw: string,
  expectedSchemaVersion = 1
): CacheEnvelope<T> | null {
  try {
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.schemaVersion !== expectedSchemaVersion ||
      typeof parsed.checksum !== 'string'
    ) {
      return null;
    }
    const payloadJson = JSON.stringify(parsed.payload);
    const actualChecksum = computeChecksum(
      payloadJson,
      parsed.schemaVersion,
      parsed.negativeSentinel === true
    );
    if (actualChecksum !== parsed.checksum) {
      return null; // Corrupted or tampered cache entry treated as clean cache miss
    }
    return Object.freeze(parsed);
  } catch {
    return null;
  }
}
