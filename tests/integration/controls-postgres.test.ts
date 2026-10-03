import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
test('Controls upgrade and atomic estimate/approval/cancellation decisions persist across restart', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const client = await pool.connect();
    try { await migrateProjectOpsPostgres(client, (await loadProjectOpsPostgresMigrations()).slice(0, 4)); } finally { client.release(); }
    const config = { databaseUrl, host: '127.0.0.1', port: 0 }; let app = await startProjectOpsPostgresApp(config);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'controls-acceptance-password');
      let origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'controls-acceptance-password' }) });
      assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0]; const csrf = (await login.json()).csrfToken;
      const headers = () => ({ origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf });
      const send = (path: string, body: unknown, overrides = {}) => fetch(origin + '/projectops/' + path, { method: 'POST', headers: { ...headers(), ...overrides }, body: JSON.stringify(body) });
      const read = (id: string) => fetch(origin + '/projectops/project-requests/' + id, { headers: headers() }).then(r => r.json());
      await send('clients', { id: 'c', name: 'Client' });
      for (const id of ['r', 'race']) await send('project-requests', { id, clientId: 'c', title: id, brief: 'Brief' });
      const root = 'project-requests/r';
      assert.equal((await send(root + '/control', { action: 'cancel', expectedRevision: 1 }, { 'x-csrf-token': '' })).status, 403);
      assert.equal((await send(root + '/status', { status: 'approved' })).status, 400);
      assert.equal((await send(root + '/estimate', { amountCents: 12345, currency: 'EUR', expectedRevision: 1 })).status, 200);
      const race = await Promise.all([send(root + '/estimate', { amountCents: 20000, currency: 'EUR', expectedRevision: 2 }), send(root + '/approve', { approvedBy: 'Operator', expectedRevision: 2 })]);
      assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
      let current = await read('r');
      if (current.status === 'estimated') assert.equal((await send(root + '/approve', { approvedBy: 'Operator', expectedRevision: current.revision })).status, 200);
      current = await read('r'); assert.equal(current.approvedBy, 'Operator');
      assert.equal((await send(root + '/control', { action: 'start', expectedRevision: current.revision })).status, 200);
      await send(root + '/notes', { id: 'n', author: 'Operator', body: 'Retained record' });
      current = await read('r'); assert.equal((await send(root + '/control', { action: 'hold', expectedRevision: current.revision })).status, 200);
      current = await read('r'); assert.equal((await send(root + '/control', { action: 'deliver', expectedRevision: current.revision })).status, 400);
      assert.equal((await send(root + '/work-logs', { id: 'w', actor: 'Operator', minutes: 30, note: 'Blocked while held' })).status, 400);
      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      current = await read('r'); assert.equal(current.status, 'on_hold');
      assert.equal((await send(root + '/control', { action: 'resume', expectedRevision: current.revision })).status, 200);
      current = await read('r'); const cancelRace = await Promise.all([send(root + '/control', { action: 'cancel', expectedRevision: current.revision }), send(root + '/control', { action: 'deliver', expectedRevision: current.revision })]);
      assert.deepEqual(cancelRace.map(r => r.status).sort(), [200, 409]); current = await read('r');
      assert.ok(['cancelled', 'delivered'].includes(current.status));
      assert.equal((await send(root + '/control', { action: 'archive', expectedRevision: current.revision })).status, 200);
      assert.equal((await send(root + '/notes', { id: 'blocked', author: 'Operator', body: 'Blocked' })).status, 409);
      assert.equal((await fetch(origin + '/projectops/' + root + '/notes', { headers: headers() }).then(r => r.json())).length, 1);
      const earlyRace = await Promise.all([send('project-requests/race/estimate', { amountCents: 100, currency: 'USD', expectedRevision: 1 }), send('project-requests/race/control', { action: 'cancel', expectedRevision: 1 })]);
      assert.deepEqual(earlyRace.map(r => r.status).sort(), [200, 409]);
    } finally { await app.close(); }
  });
});
