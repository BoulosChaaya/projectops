// EXEC-TEST-003: Dependency Substitution
export interface RecordedCall<Args extends unknown[]> {
  args: Args;
  timestampMs: number;
}

export interface TestDouble<T> {
  target: T;
  calls: Record<string, RecordedCall<unknown[]>[]>;
  reset(): void;
}

export function createTestDouble<T extends Record<string, unknown>>(
  implementation: T
): TestDouble<T> {
  const calls: Record<string, RecordedCall<unknown[]>[]> = {};

  const proxy = new Proxy(implementation, {
    get(obj, prop) {
      const key = String(prop);
      const value = obj[key];
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]) => {
        if (!calls[key]) {
          calls[key] = [];
        }
        calls[key].push({ args, timestampMs: Date.now() });
        return (value as (...a: unknown[]) => unknown).apply(obj, args);
      };
    },
  });

  return {
    target: proxy,
    calls,
    reset() {
      for (const k of Object.keys(calls)) {
        delete calls[k];
      }
    },
  };
}
