// EXEC-SEC-037..042: Output Encoding, SQLi Prevention & Abuse Rate Limiting
const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export function encodeUntrustedOutput(raw: string): string {
  return String(raw).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

export function assertParameterizedSql(sql: string, values: readonly unknown[]): void {
  if (/('[^']*'\s*OR\s*'1'\s*=\s*'1'|--|;\s*DROP\s+TABLE)/i.test(sql)) {
    throw new Error('SQL injection guard triggered: unsafe SQL pattern rejected.');
  }
  const placeholderMatches = sql.match(/\$\d+/g) ?? [];
  const uniqueIndices = new Set(placeholderMatches.map((m) => Number(m.slice(1))));
  if (uniqueIndices.size !== values.length) {
    throw new Error('Parameterized SQL mismatch between placeholders and values.');
  }
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(options: { maxRequests: number; windowMs: number }) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  public consume(
    subjectKey: string,
    nowMs: number = Date.now()
  ): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const cutoff = nowMs - this.windowMs;
    const history = (this.buckets.get(subjectKey) ?? []).filter((ts) => ts > cutoff);
    if (history.length >= this.maxRequests) {
      const oldest = history[0];
      const retryAfterMs = Math.max(1, oldest + this.windowMs - nowMs);
      this.buckets.set(subjectKey, history);
      return Object.freeze({ allowed: false, remaining: 0, retryAfterMs });
    }
    history.push(nowMs);
    this.buckets.set(subjectKey, history);
    return Object.freeze({
      allowed: true,
      remaining: this.maxRequests - history.length,
      retryAfterMs: 0,
    });
  }
}
