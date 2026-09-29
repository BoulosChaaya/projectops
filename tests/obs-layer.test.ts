// Verification Suite for Layer 7: OBS (EXEC-OBS-001..031: Diagnosable System)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  CounterMetric,
  HistogramMetric,
  sanitizeMetricLabels,
} from '../packages/observability/src/metrics/index.ts';
import { startSpan, parseTraceparent } from '../packages/observability/src/tracing/index.ts';
import { redactTelemetryText } from '../packages/observability/src/privacy/redact.ts';
import { evaluateSloBurnRate, AlertDeduplicator } from '../packages/observability/src/slo/index.ts';

unitTest('EXEC-OBS-001..031: Metrics, p95/p99 histograms, cardinality guard, W3C tracing, PII scrubbing & SLO burn-rate alerts', () => {
  const counter = new CounterMetric();
  assert.equal(counter.inc(3), 3);
  assert.equal(counter.getValue(), 3);
  assert.throws(() => counter.inc(-1), /cannot be decremented/);

  const hist = new HistogramMetric();
  for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 250]) {
    hist.observe(ms);
  }
  const snap = hist.snapshot();
  assert.equal(snap.count, 10);
  assert.equal(snap.p50, 50);
  assert.equal(snap.p99, 250);

  const safeLabels = sanitizeMetricLabels({
    route: '/orders/:id',
    method: 'POST',
    userId: 'usr-high-cardinality',
    email: 'secret@uruk.dev',
  });
  assert.deepEqual(safeLabels, { route: '/orders/:id', method: 'POST' });

  let clock = 1000;
  const rootSpan = startSpan('http.post.orders', undefined, () => clock);
  clock += 45;
  const childSpan = startSpan('queue.enqueue.payment', rootSpan.traceparent, () => clock);
  clock += 15;

  const endedChild = childSpan.end(clock);
  const endedRoot = rootSpan.end(clock);
  assert.equal(endedChild.traceId, endedRoot.traceId);
  assert.equal(endedChild.parentSpanId, endedRoot.spanId);
  assert.equal(endedChild.durationMs, 15);
  assert.ok(parseTraceparent(rootSpan.traceparent));

  const scrubbed = redactTelemetryText('User enki@uruk.dev failed auth with Bearer eyJhbGciOiJIUzI1NiJ9');
  assert.equal(scrubbed.includes('enki@uruk.dev'), false);
  assert.equal(scrubbed.includes('eyJhbGciOiJIUzI1NiJ9'), false);

  const sloBreach = evaluateSloBurnRate({
    totalRequests: 10000,
    failedRequests: 150,
    targetAvailability: 0.999,
  });
  assert.equal(sloBreach.burnRate, 15);
  assert.equal(sloBreach.pageAlertTriggered, true);

  const dedup = new AlertDeduplicator(60000);
  assert.equal(dedup.shouldEmitAlert('slo:api:high-burn', 1000), true);
  assert.equal(dedup.shouldEmitAlert('slo:api:high-burn', 30000), false);
  assert.equal(dedup.shouldEmitAlert('slo:api:high-burn', 70000), true);
});
