// EXEC-OBS-006..012: W3C Trace Context (traceparent) & Distributed Span Lifecycle
import crypto from 'node:crypto';

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly sampled: boolean;
}

export interface CompletedSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly durationMs: number;
}

export interface ActiveSpan {
  readonly name: string;
  readonly context: TraceContext;
  readonly traceparent: string;
  end(endNowMs?: number): CompletedSpan;
}

export type ClockFn = () => number;

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header: string | undefined): TraceContext | null {
  if (!header || typeof header !== 'string') return null;
  const m = header.trim().toLowerCase().match(TRACEPARENT_REGEX);
  if (!m) return null;
  const traceId = m[1];
  const parentSpanId = m[2];
  const flags = m[3];
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;

  return Object.freeze({
    traceId,
    spanId: crypto.randomBytes(8).toString('hex'),
    parentSpanId,
    sampled: (parseInt(flags, 16) & 1) === 1,
  });
}

export function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

export function startSpan(
  name: string,
  incomingTraceparent?: string,
  nowMs?: ClockFn
): ActiveSpan {
  const clockFn: ClockFn = nowMs ?? (() => Date.now());
  const parsed = parseTraceparent(incomingTraceparent);
  const context: TraceContext =
    parsed ??
    Object.freeze({
      traceId: crypto.randomBytes(16).toString('hex'),
      spanId: crypto.randomBytes(8).toString('hex'),
      sampled: true,
    });
  const startedAtMs = clockFn();

  return Object.freeze({
    name,
    context,
    traceparent: formatTraceparent(context),
    end: (endNowMs?: number): CompletedSpan => {
      const finalMs = endNowMs ?? clockFn();
      return Object.freeze({
        name,
        traceId: context.traceId,
        spanId: context.spanId,
        parentSpanId: context.parentSpanId,
        durationMs: Math.max(0, finalMs - startedAtMs),
      });
    },
  });
}
