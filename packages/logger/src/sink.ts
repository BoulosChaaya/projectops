// EXEC-FOUND-014: Log Output Routing
import type { LogLevel } from './level.ts';

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export function createMemorySink(): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    write(record: LogRecord) {
      records.push(record);
    },
  };
}

export function createStdoutSink(): LogSink {
  return {
    write(record: LogRecord) {
      try {
        process.stdout.write(JSON.stringify(record) + '\n');
      } catch {
        // Sink failure must not crash the process
      }
    },
  };
}
