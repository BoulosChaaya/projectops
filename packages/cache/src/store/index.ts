// EXEC-CACHE-001: Cache Read/Write Operations & EXEC-CACHE-018: Fast Data Access Layer
import { RawRespSocketClient } from '../resp/protocol.ts';
import { serializeCacheValue } from '../serialization/index.ts';
import { resolveTtlSeconds, type TtlPolicy } from '../invalidation/ttl.ts';
import { handleCacheHit } from './hit.ts';
import { handleCacheMiss } from './miss.ts';
import { SingleFlightCoalescer } from '../stampede/index.ts';
import { isWithinStalenessWindow, type ResourceStalenessTier } from '../staleness/index.ts';

export interface CacheStoreOptions {
  readonly respClient: RawRespSocketClient;
  readonly schemaVersion?: number;
  readonly clock?: () => number;
}

export class CacheStore {
  private readonly client: RawRespSocketClient;
  private readonly schemaVersion: number;
  private readonly clock: () => number;
  private readonly coalescer = new SingleFlightCoalescer();

  constructor(options: CacheStoreOptions) {
    this.client = options.respClient;
    this.schemaVersion = options.schemaVersion ?? 1;
    this.clock = options.clock ?? (() => Date.now());
  }

  public async set<T>(
    key: string,
    value: T | null,
    policy: TtlPolicy,
    options: { negativeSentinel?: boolean } = {}
  ): Promise<void> {
    const isNegative = options.negativeSentinel === true;
    const ttlSeconds = resolveTtlSeconds(policy, isNegative);
    const serialized = serializeCacheValue(value, {
      schemaVersion: this.schemaVersion,
      negativeSentinel: isNegative,
      nowMs: this.clock(),
    });
    await this.client.sendCommand(['SET', key, serialized, 'EX', ttlSeconds]);
  }

  public async get<T>(
    key: string,
    tier: ResourceStalenessTier = 'tier1_domain'
  ): Promise<{ hit: boolean; negative: boolean; value: T | null }> {
    if (tier === 'tier0_zero_staleness') {
      return Object.freeze({ hit: false, negative: false, value: null });
    }
    const raw = await this.client.sendCommand(['GET', key]);
    if (typeof raw !== 'string') {
      return Object.freeze({ hit: false, negative: false, value: null });
    }

    const hitRes = handleCacheHit<T>(raw, this.schemaVersion);
    if (hitRes.status === 'corrupt_miss') {
      await this.del(key);
      return Object.freeze({ hit: false, negative: false, value: null });
    }

    if (
      hitRes.storedAtMs !== undefined &&
      !isWithinStalenessWindow(hitRes.storedAtMs, tier, this.clock())
    ) {
      await this.del(key);
      return Object.freeze({ hit: false, negative: false, value: null });
    }

    return Object.freeze({
      hit: true,
      negative: hitRes.status === 'negative_hit',
      value: hitRes.value,
    });
  }

  public async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    policy: TtlPolicy & {
      readonly tier?: ResourceStalenessTier;
      readonly allowNegativeCache?: boolean;
    }
  ): Promise<{ value: T | null; source: 'cache' | 'origin' }> {
    const tier = policy.tier ?? 'tier1_domain';
    if (tier === 'tier0_zero_staleness') {
      const direct = await loader();
      return Object.freeze({ value: direct, source: 'origin' });
    }

    try {
      const cached = await this.get<T>(key, tier);
      if (cached.hit) {
        return Object.freeze({ value: cached.value, source: 'cache' });
      }
    } catch {
      // Redis unreachable -> degrade gracefully to authoritative origin
      const fallbackVal = await loader();
      return Object.freeze({ value: fallbackVal, source: 'origin' });
    }

    const loaded = await handleCacheMiss<T>(
      key,
      loader,
      async (freshVal) => {
        try {
          if (freshVal === null) {
            if (policy.allowNegativeCache) {
              await this.set(key, null, policy, { negativeSentinel: true });
            }
          } else {
            await this.set(key, freshVal, policy);
          }
        } catch {
          // Non-fatal if cache write fails
        }
      },
      this.coalescer
    );

    return Object.freeze({ value: loaded, source: 'origin' });
  }

  public async del(key: string): Promise<void> {
    await this.client.sendCommand(['DEL', key]);
  }
}
