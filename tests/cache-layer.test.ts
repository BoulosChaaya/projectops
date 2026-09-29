// Verification Suite for Layer 3: CACHE (EXEC-CACHE-001..018: Fast Data Access Layer)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  RawRespSocketClient,
  startDisposableRespServer,
} from '../packages/cache/src/resp/protocol.ts';
import { buildCacheKey } from '../packages/cache/src/keys/index.ts';
import { assertNoKeyCollision } from '../packages/cache/src/keys/collision.ts';
import { CacheStore } from '../packages/cache/src/store/index.ts';
import { CacheInvalidator } from '../packages/cache/src/invalidation/index.ts';
import { BoundedCacheEvictor } from '../packages/cache/src/eviction/index.ts';

unitTest('EXEC-CACHE-004 & 005: Versioned cache keys escape delimiters and prevent collisions', () => {
  const k1 = buildCacheKey({ namespace: 'billing', entity: 'invoice:v1', id: 'inv/100', version: 2 });
  const k2 = buildCacheKey({ namespace: 'billing:invoice', entity: 'v1', id: 'inv/100', version: 2 });
  assert.notEqual(k1, k2);
  assertNoKeyCollision([k1, k2]);
  assert.throws(() => assertNoKeyCollision([k1, k1]), /collision detected/);
});

unitTest('EXEC-CACHE-001..018: Raw RESP over node:net, Stampede Coalescing, Negative Cache, Staleness, Invalidation & Fallback', async () => {
  const respServer = await startDisposableRespServer();
  let nowMs = 1_700_000_000_000;

  try {
    const respClient = new RawRespSocketClient(respServer.host, respServer.port);
    const pong = await respClient.sendCommand(['PING']);
    assert.equal(pong, 'PONG');

    const store = new CacheStore({
      respClient,
      schemaVersion: 1,
      clock: () => nowMs,
    });
    const invalidator = new CacheInvalidator(store);

    // 1. Single-flight stampede protection: 20 concurrent misses -> 1 origin call
    let originCalls = 0;
    const accountKey = buildCacheKey({ namespace: 'IAM', entity: 'account', id: 'acc-1' });

    const concurrentReads = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.getOrLoad(
          accountKey,
          async () => {
            originCalls += 1;
            await new Promise((r) => setTimeout(r, 15));
            return { id: 'acc-1', role: 'architect' };
          },
          { baseTtlSeconds: 60, tier: 'tier1_domain' }
        )
      )
    );

    assert.equal(originCalls, 1);
    assert.deepEqual(concurrentReads[0].value, { id: 'acc-1', role: 'architect' });

    // Subsequent read hits cache directly
    const cachedHit = await store.getOrLoad(
      accountKey,
      async () => {
        originCalls += 1;
        return { id: 'acc-1', role: 'architect' };
      },
      { baseTtlSeconds: 60, tier: 'tier1_domain' }
    );
    assert.equal(cachedHit.source, 'cache');
    assert.equal(originCalls, 1);

    // 2. Staleness window enforcement (tier1_domain max staleness = 5000ms)
    nowMs += 6_000;
    const staleReload = await store.getOrLoad(
      accountKey,
      async () => {
        originCalls += 1;
        return { id: 'acc-1', role: 'senior-architect' };
      },
      { baseTtlSeconds: 60, tier: 'tier1_domain' }
    );
    assert.equal(staleReload.source, 'origin');
    assert.equal(originCalls, 2);

    // 3. Negative caching for missing records
    let missingCalls = 0;
    const missingKey = buildCacheKey({ namespace: 'IAM', entity: 'account', id: 'non-existent' });
    const miss1 = await store.getOrLoad(
      missingKey,
      async () => {
        missingCalls += 1;
        return null;
      },
      { baseTtlSeconds: 60, negativeTtlSeconds: 10, allowNegativeCache: true }
    );
    const miss2 = await store.getOrLoad(
      missingKey,
      async () => {
        missingCalls += 1;
        return null;
      },
      { baseTtlSeconds: 60, negativeTtlSeconds: 10, allowNegativeCache: true }
    );
    assert.equal(miss1.value, null);
    assert.equal(miss2.source, 'cache');
    assert.equal(missingCalls, 1);

    // 4. Event-driven invalidation on mutation
    const invCount = await invalidator.onMutation({
      keys: [accountKey, missingKey],
      reason: 'account.updated',
    });
    assert.equal(invCount, 2);

    // 5. Bounded LRU Eviction
    const lru = new BoundedCacheEvictor<string>(2);
    lru.set('k1', 'v1');
    lru.set('k2', 'v2');
    lru.get('k1'); // k1 is now most-recently used; k2 is oldest
    const evicted = lru.set('k3', 'v3');
    assert.equal(evicted, 'k2');
  } finally {
    await respServer.close();
  }

  // 6. Graceful fallback to origin when Redis server is down
  const deadClient = new RawRespSocketClient('127.0.0.1', 63999);
  const fallbackStore = new CacheStore({ respClient: deadClient });
  const fallbackResult = await fallbackStore.getOrLoad(
    'uruk:test:fallback:v1:1',
    async () => ({ recoveredFromDb: true }),
    { baseTtlSeconds: 30 }
  );
  assert.deepEqual(fallbackResult, {
    value: { recoveredFromDb: true },
    source: 'origin',
  });
});
