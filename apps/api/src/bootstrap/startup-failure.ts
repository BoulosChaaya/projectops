// EXEC-FOUND-006: Startup Failure Handling
import type { Logger } from '../../../../packages/logger/src/index.ts';

export function handleStartupFailure(
  error: unknown,
  logger?: Logger,
  exitFn: (code: number) => never = (code) => process.exit(code)
): never {
  const message = error instanceof Error ? error.message : String(error);
  if (logger) {
    logger.fatal('startup.failed', { cause: message });
  }
  return exitFn(1);
}
