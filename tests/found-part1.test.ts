// Verification Suite for EXEC-TEST-001..003 and EXEC-FOUND-001..033 (Runnable Service)
import os from 'node:os';
import path from 'node:path';
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { testIsolated } from '../packages/testing-kit/src/unit/isolation.ts';
import { createTestDouble } from '../packages/testing-kit/src/unit/test-double.ts';
import { runtimeLifecycleStateModel } from '../packages/runtime/lifecycle/state.ts';
import { inFlightRequestDraining } from '../packages/runtime/lifecycle/draining.ts';
import { loadEnvironment } from '../packages/config/src/environment.ts';
import { requireConfig } from '../packages/config/src/required.ts';
import { parseConfigValue } from '../packages/config/src/parsers.ts';
import { resolveConfigDefault } from '../packages/config/src/defaults.ts';
import { resolvePort } from '../packages/config/src/port.ts';
import { validateRuntimeConfig } from '../packages/config/src/runtime-config.ts';
import { createLogger, withLogContext } from '../packages/logger/src/index.ts';
import { createMemorySink } from '../packages/logger/src/sink.ts';
import { isUnrecoverable } from '../packages/runtime/src/faults/classify.ts';
import { signalFault } from '../packages/runtime/src/faults/signal.ts';
import { detectCrash } from '../packages/runtime/src/supervision/crash.ts';
import { createRestartPolicy } from '../packages/runtime/src/supervision/restart-policy.ts';
import { allowRestart } from '../packages/runtime/src/supervision/restart-loop.ts';
import { createFileSystemAccess } from '../packages/runtime/src/fs/index.ts';
import { HealthService } from '../apps/api/src/health/health.service.ts';
import { initializeDependencies } from '../apps/api/src/bootstrap/dependencies.ts';
import { bindNetwork } from '../apps/api/src/bootstrap/network.ts';
import { bootstrap } from '../apps/api/src/bootstrap/index.ts';

unitTest('EXEC-TEST-001..003: unitTest, testIsolated, and TestDouble work deterministically', async () => {
  await testIsolated(async (ctx) => {
    assert.equal(ctx.clock.nowIso(), '2026-09-28T12:00:00.000Z');
    ctx.clock.advanceMs(5000);
    assert.equal(ctx.clock.nowIso(), '2026-09-28T12:00:05.000Z');

    const double = createTestDouble({
      compute(x: number) {
        return x * 2;
      },
    });
    assert.equal(double.target.compute(21), 42);
    assert.equal(double.calls.compute.length, 1);
  });
});

unitTest('EXEC-FOUND-003: Runtime Lifecycle State Model enforces legal transitions', () => {
  const sm = runtimeLifecycleStateModel.createStateMachine();
  assert.equal(sm.getState(), 'starting');
  assert.throws(() => sm.transitionTo('draining'), /Illegal lifecycle state transition/);
  sm.transitionTo('accepting');
  sm.transitionTo('draining');
  sm.transitionTo('stopping');
  sm.transitionTo('stopped');
  assert.equal(sm.getState(), 'stopped');
  assert.equal(sm.getHistory().length, 4);
});

unitTest('EXEC-FOUND-004 & 007..010 & 031: Environment loading, parsing, defaults, and RuntimeConfig validation', () => {
  const source = { SERVICE_NAME: 'uruk-api', PORT: '4100', LOG_LEVEL: 'debug' };
  const env = loadEnvironment(source);
  source.SERVICE_NAME = 'mutated';
  assert.equal(env.SERVICE_NAME, 'uruk-api');
  assert.equal(requireConfig('SERVICE_NAME', env), 'uruk-api');
  assert.throws(() => requireConfig('MISSING_KEY', env), /missing or empty/);

  assert.equal(parseConfigValue('PORT', '8080', { type: 'integer', min: 1, max: 65535 }), 8080);
  assert.equal(parseConfigValue('FLAG', 'true', { type: 'boolean' }), true);
  assert.equal(resolveConfigDefault('HOST', undefined), '127.0.0.1');
  assert.equal(resolveConfigDefault('HOST', '0.0.0.0'), '0.0.0.0');
  assert.equal(resolvePort({ PORT: '0' }), 0);
  assert.throws(() => resolvePort({ PORT: '70000' }), /out of range/);

  const runtimeCfg = validateRuntimeConfig(env);
  assert.equal(runtimeCfg.SERVICE_NAME, 'uruk-api');
  assert.equal(runtimeCfg.PORT, 4100);
  assert.equal(runtimeCfg.HOST, '127.0.0.1');
  assert.equal(runtimeCfg.LOG_LEVEL, 'debug');
});

unitTest('EXEC-FOUND-011..014: Structured logger emits JSON records, respects levels, isolates context, and redacts secrets', () => {
  const sink = createMemorySink();
  const parent = createLogger({
    minLevel: 'info',
    context: { service: 'uruk-api', apiKey: 'top-secret' },
    sink,
    clock: () => '2026-09-28T12:00:00.000Z',
  });

  parent.debug('ignored.debug');
  const child = withLogContext(parent, { requestId: 'req-1', password: 'my-password' });
  child.info('request.handled', { status: 200 });
  parent.warn('parent.log');

  assert.equal(sink.records.length, 2);
  assert.equal(sink.records[0].level, 'info');
  assert.equal(sink.records[0].context.requestId, 'req-1');
  assert.equal(sink.records[0].context.apiKey, '[Redacted]');
  assert.equal(sink.records[0].context.password, '[Redacted]');
  assert.equal(sink.records[1].context.requestId, undefined);
});

unitTest('EXEC-FOUND-015..018: Fault signaling, classification, and in-flight draining', async () => {
  const fatalErr = Object.assign(new Error('Address in use'), { code: 'EADDRINUSE' });
  const recovErr = new Error('Temporary timeout');

  assert.equal(isUnrecoverable(fatalErr), true);
  assert.equal(isUnrecoverable(recovErr), false);

  const fault = signalFault(fatalErr, { component: 'listener' });
  assert.equal(fault.severity, 'fatal');
  assert.equal(fault.cause, fatalErr);

  const drainer = inFlightRequestDraining();
  assert.equal(drainer.tryEnter(), true);
  setTimeout(() => drainer.leave(), 15);
  const drainRes = await drainer.drain(500);
  assert.equal(drainRes.completedGracefully, true);
  assert.equal(drainer.tryEnter(), false);
});

unitTest('EXEC-FOUND-019..022: HealthService liveness, readiness, and dependency aggregation', async () => {
  let dbHealthy = true;
  const health = new HealthService([
    { name: 'postgres', check: () => dbHealthy },
  ]);

  assert.equal(health.checkLiveness().ok, true);
  assert.equal((await health.checkReadiness()).ok, false); // Not initialized yet

  health.setInitialized(true);
  assert.equal((await health.checkReadiness()).ok, true);

  dbHealthy = false;
  const degraded = await health.checkReadiness();
  assert.equal(degraded.ok, false);
  assert.deepEqual((degraded.details as { failingDependencies: string[] }).failingDependencies, ['postgres']);
});

unitTest('EXEC-FOUND-023..026: Process supervision crash detection, restart policy, and loop prevention', () => {
  const policy = createRestartPolicy();
  const clean = detectCrash({ code: 0, signal: null });
  const crash = detectCrash({ code: 1, signal: null });
  const configFatal = detectCrash({ code: 78, signal: null });

  assert.equal(policy.shouldRestart(clean), false);
  assert.equal(policy.shouldRestart(crash), true);
  assert.equal(policy.shouldRestart(configFatal), false);

  const now = 100_000;
  assert.equal(allowRestart([90_000, 92_000, 95_000], { nowMs: now, maxRestartsInWindow: 3 }), false);
  assert.equal(allowRestart([10_000, 20_000, 95_000], { nowMs: now, windowMs: 60_000, maxRestartsInWindow: 3 }), true);
});

unitTest('EXEC-FOUND-027..029: Filesystem permission boundary and temporary storage cleanup', async () => {
  const baseTmp = path.join(os.tmpdir(), 'uruk-fs-test');
  const fsAccess = createFileSystemAccess([baseTmp], baseTmp);

  await assert.rejects(
    () => fsAccess.readText('/etc/passwd'),
    /access denied outside allowed roots/
  );

  let capturedTempPath = '';
  const result = await fsAccess.temp.withTempFile('probe', async (tempPath) => {
    capturedTempPath = tempPath;
    await fsAccess.writeText(tempPath, 'hello-uruk');
    return await fsAccess.readText(tempPath);
  });

  assert.equal(result, 'hello-uruk');
  await assert.rejects(() => fsAccess.readText(capturedTempPath));
});

unitTest('EXEC-FOUND-002, 005, 030, 032, 033: Bootstrap reaches Runnable Service, serves probes, detects EADDRINUSE, and shuts down cleanly', async () => {
  const order: string[] = [];
  const sink = createMemorySink();
  const logger = createLogger({ minLevel: 'info', sink });

  const service = await bootstrap({
    env: {
      SERVICE_NAME: 'uruk-api',
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'info',
    },
    logger,
    dependencies: [
      {
        name: 'db-pool',
        dependsOn: ['config-check'],
        init: () => {
          order.push('db-pool');
        },
      },
      {
        name: 'config-check',
        init: () => {
          order.push('config-check');
        },
      },
    ],
  });

  try {
    assert.deepEqual(order, ['config-check', 'db-pool']);
    assert.equal(service.stateMachine.getState(), 'accepting');
    assert.ok(service.bound.port > 0);

    // Address-in-use bind failure classification test on the occupied port
    await assert.rejects(
      () => bindNetwork({ HOST: '127.0.0.1', PORT: service.bound.port }),
      /address_in_use/
    );

    // External HTTP probe confirms Runnable Service (EXEC-FOUND-033)
    const liveRes = await fetch(`http://127.0.0.1:${service.bound.port}/health/live`);
    const readyRes = await fetch(`http://127.0.0.1:${service.bound.port}/health/ready`);
    assert.equal(liveRes.status, 200);
    assert.equal(readyRes.status, 200);
  } finally {
    await service.shutdown();
    assert.equal(service.stateMachine.getState(), 'stopped');
  }
});
