// EXEC-FOUND-037: Connection Timeout Enforcement
import { rejectMalformedRequest } from './malformed-request.ts';

export interface ConnectionTimeoutPolicy {
  readonly requestTimeoutMs: number;
  readonly idleTimeoutMs: number;
  withTimeout<T>(operation: () => Promise<T>): Promise<T>;
}

export function createConnectionTimeoutPolicy(options: {
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
} = {}): ConnectionTimeoutPolicy {
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000;

  return Object.freeze({
    requestTimeoutMs,
    idleTimeoutMs,
    async withTimeout<T>(operation: () => Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(rejectMalformedRequest('request_timeout', { requestTimeoutMs }));
        }, requestTimeoutMs);
      });

      try {
        return await Promise.race([operation(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  });
}
