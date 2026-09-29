// Verification Suite for Layer 4: QUEUE (EXEC-QUEUE-001..039: Reliable Asynchronous Processing)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { QueueBroker } from '../packages/queue/src/producer/index.ts';
import { TransactionalOutboxRelay } from '../packages/queue/src/outbox/index.ts';
import { IdempotencyStore } from '../packages/queue/src/idempotency/index.ts';
import { replayDeadLetterJob } from '../packages/queue/src/dlq/replay.ts';
import { WorkerRuntime } from '../apps/worker/src/consumer/index.ts';

unitTest('EXEC-QUEUE-001..039: Outbox Handoff, Retries with Backoff/Jitter, Idempotency, Poison Isolation, DLQ Replay & Drain', async () => {
  let nowMs = 1_700_000_000_000;
  const broker = new QueueBroker({ maxDepth: 50 });
  const outbox = new TransactionalOutboxRelay();
  const idempotency = new IdempotencyStore();

  const worker = new WorkerRuntime({
    workerId: 'worker-alpha',
    queueName: 'payments',
    broker,
    idempotencyStore: idempotency,
    maxConcurrency: 2,
    jobTimeoutMs: 100,
    backoffConfig: { baseDelayMs: 100, maxDelayMs: 1000 },
    nowFn: () => nowMs,
  });

  const ledgerCharges: string[] = [];
  let transientFailuresRemaining = 2;

  worker.registerHandler('charge_card', async (job, helpers) => {
    helpers.renewLease();
    if (transientFailuresRemaining > 0) {
      transientFailuresRemaining -= 1;
      const err = new Error('Gateway 503 timeout');
      (err as { code?: string; transient?: boolean }).code = 'ETIMEDOUT';
      (err as { transient?: boolean }).transient = true;
      throw err;
    }
    ledgerCharges.push(`${job.idempotencyKey}:${String(job.payload.amount)}`);
    return { charged: true };
  });

  // 1. Stage job in transactional outbox and relay to queue broker
  outbox.stageInTransaction({
    id: 'outbox-1',
    queueName: 'payments',
    jobName: 'charge_card',
    idempotencyKey: 'idem-order-100',
    payload: { orderId: 'ord-100', amount: 2500 },
  });
  assert.equal(outbox.getPendingCount(), 1);
  const relayed = await outbox.relayPending(broker, nowMs);
  assert.equal(relayed, 1);
  assert.equal(outbox.getPendingCount(), 0);

  // 2. First 2 attempts fail transiently and reschedule with exponential backoff + jitter
  const attempt1 = await worker.processNext();
  assert.equal(attempt1.status, 'retried');
  assert.equal(ledgerCharges.length, 0);

  // Advance clock past first backoff window
  nowMs += 200;
  const attempt2 = await worker.processNext();
  assert.equal(attempt2.status, 'retried');

  // Advance clock past second backoff window -> 3rd attempt succeeds!
  nowMs += 500;
  const attempt3 = await worker.processNext();
  assert.equal(attempt3.status, 'completed');
  assert.deepEqual(ledgerCharges, ['idem-order-100:2500']);

  // 3. Duplicate delivery with same idempotencyKey is deduplicated (zero duplicate side effects)
  await broker.enqueue({
    queueName: 'payments',
    jobName: 'charge_card',
    idempotencyKey: 'idem-order-100',
    payload: { orderId: 'ord-100', amount: 2500 },
    nowMs,
  });
  const dupAttempt = await worker.processNext();
  assert.equal(dupAttempt.status, 'deduplicated');
  assert.deepEqual(ledgerCharges, ['idem-order-100:2500']); // Still only charged once!

  // 4. Poison-pill job is isolated immediately to DLQ without retry loops
  const poisonJob = await broker.enqueue({
    queueName: 'payments',
    jobName: 'charge_card',
    idempotencyKey: 'idem-poison-1',
    payload: { __poison: true },
    maxAttempts: 5,
    nowMs,
  });
  const poisonRes = await worker.processNext();
  assert.equal(poisonRes.status, 'dead_lettered');
  assert.equal(broker.dlq.getById(poisonJob.jobId)?.failureCategory, 'poison_pill');

  // 5. Permanent failure goes to DLQ and can be replayed after operator fix
  let fixApplied = false;
  worker.registerHandler('sync_webhook', async () => {
    if (!fixApplied) {
      throw new Error('Permanent schema mismatch');
    }
    return { synced: true };
  });

  const webhookJob = await broker.enqueue({
    queueName: 'payments',
    jobName: 'sync_webhook',
    idempotencyKey: 'idem-webhook-1',
    payload: { url: 'https://example.com/hook' },
    nowMs,
  });

  const failWebhook = await worker.processNext();
  assert.equal(failWebhook.status, 'dead_lettered');
  assert.equal(broker.dlq.inspectAll().length, 2);

  fixApplied = true;
  await replayDeadLetterJob(broker.dlq, webhookJob.jobId, (j) => broker.enqueueRaw(j), nowMs);
  const replayedRes = await worker.processNext();
  assert.equal(replayedRes.status, 'completed');

  // 6. Graceful worker drain
  const drainRes = await worker.drain(1000);
  assert.equal(drainRes.drainedCleanly, true);
});
