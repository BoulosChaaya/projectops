// EXEC-DB-060: Slow Query Logging
import { fingerprintSql } from '../query-performance/index.ts';

export interface SlowQueryRecord {
  readonly durationMs: number;
  readonly fingerprint: string;
  readonly operationName: string;
  readonly correlationId?: string;
}

export function createSlowQueryRecord(input: {
  sql: string;
  durationMs: number;
  operationName: string;
  correlationId?: string;
}): SlowQueryRecord {
  // Never include raw bound parameters or connection credentials
  return Object.freeze({
    durationMs: input.durationMs,
    fingerprint: fingerprintSql(input.sql),
    operationName: input.operationName,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });
}
