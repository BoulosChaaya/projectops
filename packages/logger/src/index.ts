// EXEC-FOUND-011: Structured Logging
import { assertLogLevel, shouldEmitLog, type LogLevel } from './level.ts';
import { mergeLogContext, sanitizeContext } from './context.ts';
import { createStdoutSink, type LogRecord, type LogSink } from './sink.ts';

export interface Logger {
  log(level: LogLevel, message: string, extraContext?: Record<string, unknown>): void;
  trace(message: string, extraContext?: Record<string, unknown>): void;
  debug(message: string, extraContext?: Record<string, unknown>): void;
  info(message: string, extraContext?: Record<string, unknown>): void;
  warn(message: string, extraContext?: Record<string, unknown>): void;
  error(message: string, extraContext?: Record<string, unknown>): void;
  fatal(message: string, extraContext?: Record<string, unknown>): void;
  withContext(childContext: Record<string, unknown>): Logger;
}

export interface CreateLoggerOptions {
  minLevel?: LogLevel;
  context?: Record<string, unknown>;
  sink?: LogSink;
  clock?: () => string;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minLevel = assertLogLevel(options.minLevel ?? 'info');
  const baseContext = sanitizeContext(options.context ?? {});
  const sink = options.sink ?? createStdoutSink();
  const clock = options.clock ?? (() => new Date().toISOString());

  const emit = (level: LogLevel, message: string, extraContext: Record<string, unknown> = {}) => {
    const validatedLevel = assertLogLevel(level);
    if (!shouldEmitLog(validatedLevel, minLevel)) {
      return;
    }
    const record: LogRecord = Object.freeze({
      timestamp: clock(),
      level: validatedLevel,
      message,
      context: mergeLogContext(baseContext, extraContext),
    });
    try {
      sink.write(record);
    } catch {
      // Deterministic non-throwing sink routing
    }
  };

  return Object.freeze<Logger>({
    log: emit,
    trace: (msg, ctx) => emit('trace', msg, ctx),
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    fatal: (msg, ctx) => emit('fatal', msg, ctx),
    withContext(childContext: Record<string, unknown>): Logger {
      return createLogger({
        minLevel,
        context: mergeLogContext(baseContext, childContext),
        sink,
        clock,
      });
    },
  });
}

export function withLogContext(logger: Logger, context: Record<string, unknown>): Logger {
  return logger.withContext(context);
}

export { type LogLevel, type LogSink, type LogRecord };
export { describeError, redactSecrets, type ErrorDescription } from './error.ts';
