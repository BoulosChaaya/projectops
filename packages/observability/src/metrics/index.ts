// EXEC-OBS-001..005 & 014: In-Process Metrics, Percentiles & Cardinality Guard
const FORBIDDEN_HIGH_CARDINALITY_LABELS = new Set([
  'userid',
  'user_id',
  'email',
  'requestid',
  'request_id',
  'correlationid',
  'correlation_id',
  'sessionid',
  'ip',
]);

export interface HistogramSnapshot {
  readonly count: number;
  readonly sum: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export function sanitizeMetricLabels(
  labels: Readonly<Record<string, string>> = {}
): Readonly<Record<string, string>> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (!FORBIDDEN_HIGH_CARDINALITY_LABELS.has(k.toLowerCase())) {
      clean[k] = String(v);
    }
  }
  return Object.freeze(clean);
}

export class CounterMetric {
  private value = 0;

  public inc(delta = 1): number {
    if (delta < 0) {
      throw new Error('Monotonic counter cannot be decremented.');
    }
    this.value += delta;
    return this.value;
  }

  public getValue(): number {
    return this.value;
  }
}

export class GaugeMetric {
  private value = 0;

  public setValue(val: number): void {
    this.value = val;
  }

  public getValue(): number {
    return this.value;
  }
}

export class HistogramMetric {
  private readonly samples: number[] = [];

  public observe(value: number): void {
    if (Number.isFinite(value) && value >= 0) {
      this.samples.push(value);
    }
  }

  public snapshot(): HistogramSnapshot {
    if (this.samples.length === 0) {
      return Object.freeze({ count: 0, sum: 0, p50: 0, p95: 0, p99: 0 });
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const percentile = (p: number): number => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
      return sorted[idx];
    };
    return Object.freeze({
      count: sorted.length,
      sum,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    });
  }
}
