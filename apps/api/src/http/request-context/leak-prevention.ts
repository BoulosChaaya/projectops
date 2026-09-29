// EXEC-FOUND-059: Cross-Request State Leak Prevention
import { getCurrentRequestContext } from './context.ts';

export function assertNoCrossRequestState(expectedRequestId?: string): void {
  const ctx = getCurrentRequestContext();
  if (!ctx) {
    throw new Error('Cross-request state violation: No active RequestContext in AsyncLocalStorage.');
  }
  if (expectedRequestId !== undefined && ctx.requestId !== expectedRequestId) {
    throw new Error(
      `Cross-request state leak detected: expected requestId="${expectedRequestId}", observed="${ctx.requestId}".`
    );
  }
}
