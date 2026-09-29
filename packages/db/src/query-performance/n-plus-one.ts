// EXEC-DB-050: N+1 Query Detection
import type { QueryTraceEntry } from './index.ts';

export interface NPlusOneFinding {
  readonly fingerprint: string;
  readonly operationName: string;
  readonly occurrences: number;
}

export function detectNPlusOne(
  traces: readonly QueryTraceEntry[],
  threshold = 5
): NPlusOneFinding[] {
  const counts = new Map<string, { operationName: string; count: number }>();

  for (const entry of traces) {
    const prev = counts.get(entry.fingerprint);
    if (prev) {
      prev.count += 1;
    } else {
      counts.set(entry.fingerprint, { operationName: entry.operationName, count: 1 });
    }
  }

  const findings: NPlusOneFinding[] = [];
  for (const [fingerprint, data] of counts.entries()) {
    if (data.count >= threshold) {
      findings.push(
        Object.freeze({
          fingerprint,
          operationName: data.operationName,
          occurrences: data.count,
        })
      );
    }
  }
  return findings;
}
