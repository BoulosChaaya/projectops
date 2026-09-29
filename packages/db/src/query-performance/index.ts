// EXEC-DB-048: Query Performance Awareness
export interface QueryTraceEntry {
  readonly operationName: string;
  readonly fingerprint: string;
  readonly durationMs: number;
  readonly rowCount: number;
}

export function fingerprintSql(sql: string): string {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

export class QueryPerformanceProbe {
  private readonly traces: QueryTraceEntry[] = [];

  public record(operationName: string, sql: string, durationMs: number, rowCount: number): void {
    this.traces.push(
      Object.freeze({
        operationName,
        fingerprint: fingerprintSql(sql),
        durationMs,
        rowCount,
      })
    );
  }

  public getTraces(): ReadonlyArray<QueryTraceEntry> {
    return Object.freeze([...this.traces]);
  }
}
