// EXEC-CACHE-010: Explicit Event-Driven Invalidation
export interface MutationInvalidationEvent {
  readonly keys: readonly string[];
  readonly reason: string;
}

export interface InvalidatableStore {
  del(key: string): Promise<void>;
}

export async function invalidateOnMutation(
  store: InvalidatableStore,
  event: MutationInvalidationEvent
): Promise<number> {
  let invalidated = 0;
  for (const key of event.keys) {
    await store.del(key);
    invalidated += 1;
  }
  return invalidated;
}
