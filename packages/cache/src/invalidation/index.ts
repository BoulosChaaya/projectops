// EXEC-CACHE-007: Cache Invalidation
import { resolveTtlSeconds, type TtlPolicy } from './ttl.ts';
import { invalidateOnMutation, type InvalidatableStore, type MutationInvalidationEvent } from './event-driven.ts';

export class CacheInvalidator {
  private readonly store: InvalidatableStore;

  constructor(store: InvalidatableStore) {
    this.store = store;
  }

  public computeTtl(policy: TtlPolicy, isNegative = false): number {
    return resolveTtlSeconds(policy, isNegative);
  }

  public async onMutation(event: MutationInvalidationEvent): Promise<number> {
    return await invalidateOnMutation(this.store, event);
  }
}
