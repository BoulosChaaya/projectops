// EXEC-FOUND-012: Log Level Classification
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
});

export function isValidLogLevel(level: unknown): level is LogLevel {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(LOG_LEVEL_ORDER, level);
}

export function assertLogLevel(level: unknown): LogLevel {
  if (!isValidLogLevel(level)) {
    throw new Error(`Invalid LogLevel "${String(level)}".`);
  }
  return level;
}

export function shouldEmitLog(recordLevel: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[recordLevel] >= LOG_LEVEL_ORDER[minLevel];
}
