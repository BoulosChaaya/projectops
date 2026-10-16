import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { relay } from './db-relay.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { checkUptime } from '../../scripts/projectops-uptime.mjs';

const SHA = 'c'.repeat(40);

// The uptime monitor is checked against the real application, not a description of it: a renamed
// sign-in route, a liveness check that stops reporting the commit or a readiness check that stops
// asking the database would make the monitor wrong, so they fail here first.
test('The uptime check passes against the real application, reports a database outage, and passes again after it', async () => {
  await operatorFixture(async (databaseUrl) => {
    const target = new URL(databaseUrl);
    const link = await relay({ host: target.hostname, port: Number(target.port || 5432) });
    const relayed = new URL(databaseUrl); relayed.hostname = '127.0.0.1'; relayed.port = String(link.port);
    const app = await startProjectOpsPostgresApp({ databaseUrl: relayed.toString(), host: '127.0.0.1', port: 0, commit: SHA });
    // The check accepts only https origins; its requests go to the local http server instead.
    const local = (url: URL | RequestInfo, init?: RequestInit) =>
      fetch(app.server.origin + new URL(url instanceof Request ? url.url : url).pathname, init);
    const check = () => checkUptime({ origin: 'https://projectops.example', fetch: local, sleep: async () => {} } as Parameters<typeof checkUptime>[0]);
    try {
      assert.deepEqual(await check(), { commit: SHA });
      // The process still answers, but its database does not: that is an outage for every visitor.
      await link.cut();
      await assert.rejects(check(), /^Error: Down after 2 checks.*\/health\/ready: answered 503, expected 200\.$/);
      await link.open();
      assert.deepEqual(await check(), { commit: SHA });
    } finally { await app.close(); await link.cut(); }
  });
});
