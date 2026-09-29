// EXEC-DB-058: Slow Query Detection
import { createSlowQueryThreshold, isSlowQuery, type SlowQueryThreshold } from './threshold.ts';
import { createSlowQueryRecord, type SlowQueryRecord } from './log.ts';

export class SlowQueryMonitor {
  private readonly threshold: SlowQueryThreshold;
  private readonly slowRecords: SlowQueryRecord[] = [];

  constructor(thresholdMs = 200) {
    this.threshold = createSlowQueryThreshold(thresholdMs);
  }

  public observe(input: {
    sql: string;
    durationMs: number;
    operationName: string;
    correlationId?: string;
  }): SlowQueryRecord | null {
    if (!isSlowQuery(input.durationMs, this.threshold)) {
      return null;
    }
    const rec = createSlowQueryRecord(input);
    this.slowRecords.push(rec);
    return rec;
  }

  public getSlowQueries(): ReadonlyArray<SlowQueryRecord> {
    return Object.freeze([...this.slowRecords]);
  }
}
