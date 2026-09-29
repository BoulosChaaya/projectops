// Verification Suite for Layers 8..11: TEST, CICD, OPS & ARCH (Nodes 282..428)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { runConcurrentRace, FaultInjector } from '../packages/testing-kit/src/chaos/race-and-faults.ts';
import {
  computeArtifactProvenance,
  assertNoGitConflictMarkers,
} from '../packages/release/src/provenance/index.ts';
import {
  classifyRollbackFeasibility,
  evaluateCanaryPromotion,
} from '../packages/release/src/rollout/index.ts';
import {
  createVerifiedBackupSnapshot,
  verifyAndRestoreSnapshot,
  shouldShedLoad,
} from '../packages/runtime/src/ops/backup-restore.ts';
import {
  propagateDownstreamDeadline,
  BulkheadCompartment,
} from '../packages/resilience/src/deadline-and-bulkhead.ts';
import { VersionedEventBus } from '../packages/events/src/event-bus.ts';
import { TenantQuotaManager } from '../packages/tenancy/src/isolation.ts';

unitTest('EXEC-TEST-004..026: Concurrent race barrier and deterministic chaos fault injection', async () => {
  let counter = 0;
  const results = await runConcurrentRace([
    async () => ++counter,
    async () => ++counter,
    async () => ++counter,
  ]);
  assert.equal(results.length, 3);
  assert.equal(counter, 3);

  const injector = new FaultInjector();
  injector.armFault('db.write', new Error('Simulated disk I/O fault'));
  assert.throws(() => injector.maybeThrow('db.write'), /Simulated disk I\/O fault/);
  injector.disarmFault('db.write');
  injector.maybeThrow('db.write');
});

unitTest('EXEC-CICD-001..044: Reproducible build provenance, conflict scanner, rollback feasibility & canary gate', () => {
  const p1 = computeArtifactProvenance('uruk-api', 'abc1234', [
    { path: 'b.ts', content: '2' },
    { path: 'a.ts', content: '1' },
  ]);
  const p2 = computeArtifactProvenance('uruk-api', 'abc1234', [
    { path: 'a.ts', content: '1' },
    { path: 'b.ts', content: '2' },
  ]);
  assert.equal(p1.sha256Digest, p2.sha256Digest);

  assert.throws(
    () => assertNoGitConflictMarkers('<<<<<<< HEAD\nconst x = 1;', 'src/index.ts'),
    /Unresolved Git conflict markers/
  );

  const rev = classifyRollbackFeasibility({
    appArtifactStateless: true,
    schemaChangeKind: 'expand_only_reversible',
    externalSideEffectsReversible: true,
  });
  assert.equal(rev.automatedRollbackSafe, true);

  const irrev = classifyRollbackFeasibility({
    appArtifactStateless: true,
    schemaChangeKind: 'destructive_irreversible',
    externalSideEffectsReversible: true,
  });
  assert.equal(irrev.automatedRollbackSafe, false);
  assert.equal(irrev.strategy, 'forward_fix_required');

  assert.deepEqual(
    evaluateCanaryPromotion({ currentStagePercent: 10, errorRate: 0.05, maxAllowedErrorRate: 0.01 }),
    { action: 'rollback', nextTrafficPercent: 0 }
  );
});

unitTest('EXEC-OPS-001..036: SHA-256 verified backup/restore drill and priority-aware load shedding', () => {
  const snap = createVerifiedBackupSnapshot({ accounts: 42, ledgerTotal: 99000 });
  const restored = verifyAndRestoreSnapshot(snap);
  assert.deepEqual(restored, { accounts: 42, ledgerTotal: 99000 });

  const corrupted = { ...snap, payloadJson: '{"accounts":0}' };
  assert.throws(() => verifyAndRestoreSnapshot(corrupted), /failed SHA-256 integrity check/);

  assert.equal(
    shouldShedLoad({ cpuUtilizationRatio: 0.95, queueDepth: 50, maxQueueDepth: 100, requestPriority: 'background' }),
    true
  );
  assert.equal(
    shouldShedLoad({ cpuUtilizationRatio: 0.95, queueDepth: 50, maxQueueDepth: 100, requestPriority: 'critical' }),
    false
  );
});

unitTest('EXEC-ARCH-001..041: Deadline budget propagation, bulkhead isolation, deduplicated event bus & tenant quotas', async () => {
  assert.equal(propagateDownstreamDeadline(200, 25), 175);
  assert.throws(() => propagateDownstreamDeadline(20, 25), /deadline budget exhausted/);

  const bulkhead = new BulkheadCompartment('billing-service', 1);
  let releaseInner!: () => void;
  const innerPromise = new Promise<void>((r) => {
    releaseInner = r;
  });
  const firstTask = bulkhead.execute(async () => {
    await innerPromise;
    return 'done';
  });
  await assert.rejects(() => bulkhead.execute(async () => 'second'), /Bulkhead compartment billing-service is full/);
  releaseInner();
  assert.equal(await firstTask, 'done');

  const bus = new VersionedEventBus();
  const received: string[] = [];
  bus.subscribe('order.paid', async (evt) => {
    received.push(evt.eventId);
  });
  const pub1 = await bus.publish({ eventId: 'evt-1', eventType: 'order.paid', schemaVersion: 1, payload: {} });
  const pub2 = await bus.publish({ eventId: 'evt-1', eventType: 'order.paid', schemaVersion: 1, payload: {} });
  assert.equal(pub1.delivered, 1);
  assert.equal(pub2.deduplicated, true);
  assert.deepEqual(received, ['evt-1']);

  const quotas = new TenantQuotaManager(10);
  assert.equal(quotas.consumeQuota('tenant-alpha', 6), 6);
  assert.throws(() => quotas.consumeQuota('tenant-alpha', 5), /exceeded allocated resource quota/);
});
