// EXEC-FOUND-024: Crash Detection
export interface ProcessExitInput {
  code: number | null;
  signal: string | null;
  intentionalShutdown?: boolean;
}

export interface CrashEvent {
  readonly crashed: boolean;
  readonly code: number | null;
  readonly signal: string | null;
  readonly reason: 'clean_exit' | 'intentional_shutdown' | 'non_zero_exit' | 'unhandled_signal';
}

export function detectCrash(exit: ProcessExitInput): CrashEvent {
  if (exit.intentionalShutdown === true) {
    return Object.freeze({
      crashed: false,
      code: exit.code,
      signal: exit.signal,
      reason: 'intentional_shutdown',
    });
  }
  if (exit.code === 0 && exit.signal === null) {
    return Object.freeze({
      crashed: false,
      code: 0,
      signal: null,
      reason: 'clean_exit',
    });
  }
  if (exit.signal !== null) {
    return Object.freeze({
      crashed: true,
      code: exit.code,
      signal: exit.signal,
      reason: 'unhandled_signal',
    });
  }
  return Object.freeze({
    crashed: true,
    code: exit.code,
    signal: null,
    reason: 'non_zero_exit',
  });
}
