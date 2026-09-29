// EXEC-FOUND-058: Request Context Isolation
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly startedAtMs: number;
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
}

const contextStorage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(
  identity: { requestId: string; correlationId: string },
  startedAtMs: number = Date.now()
): RequestContext {
  const store = new Map<string, unknown>();
  return Object.freeze({
    requestId: identity.requestId,
    correlationId: identity.correlationId,
    startedAtMs,
    get<T = unknown>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): void {
      store.set(key, value);
    },
  });
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(contextStorage.run(ctx, fn));
}

export function getCurrentRequestContext(): RequestContext | undefined {
  return contextStorage.getStore();
}
