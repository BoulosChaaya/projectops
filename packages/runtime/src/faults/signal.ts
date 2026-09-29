// EXEC-FOUND-015: Fault Signaling
import { isUnrecoverable } from './classify.ts';

export interface FaultSignal {
  readonly severity: 'recoverable' | 'fatal';
  readonly message: string;
  readonly code?: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
  readonly cause: unknown;
}

export function signalFault(
  error: unknown,
  context: Record<string, unknown> = {},
  nowIso: string = new Date().toISOString()
): FaultSignal {
  const fatal = isUnrecoverable(error);
  const errObj = error instanceof Error ? error : new Error(String(error));
  const code = (error as { code?: string })?.code;

  return Object.freeze({
    severity: fatal ? 'fatal' : 'recoverable',
    message: errObj.message,
    ...(code ? { code } : {}),
    context: Object.freeze({ ...context }),
    timestamp: nowIso,
    cause: error,
  });
}
