// EXEC-FOUND-025: Restart Policy
import type { CrashEvent } from './crash.ts';

const NON_RESTARTABLE_EXIT_CODES = new Set([64, 78]); // EX_USAGE, EX_CONFIG

export interface RestartPolicy {
  shouldRestart(event: CrashEvent): boolean;
}

export function createRestartPolicy(
  nonRestartableCodes: ReadonlySet<number> = NON_RESTARTABLE_EXIT_CODES
): RestartPolicy {
  return Object.freeze({
    shouldRestart(event: CrashEvent): boolean {
      if (!event.crashed) {
        return false;
      }
      if (event.code !== null && nonRestartableCodes.has(event.code)) {
        return false;
      }
      return true;
    },
  });
}
