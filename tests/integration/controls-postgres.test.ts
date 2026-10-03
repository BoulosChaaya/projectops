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
      assert.equal((await send(root + '/work-logs', { id: 'w', actor: 'Operator', minutes: 30, note: 'Blocked while held' })).status, 409);
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

test('Real SQL guards reject a competing decision after both commands read the same snapshot', async () => {
  await operatorFixture(async (_databaseUrl, pool) => {
    const client = await pool.connect();
    try { await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations()); } finally { client.release(); }
    const { ProjectOpsConnectionSqlExecutor, ProjectOpsRepository } = await import('../../packages/projectops/src/index.ts');
    const time = '2026-10-03T12:00:00.000Z';
    let waiting = 0; let enabled = false; let release!: () => void;
    const barrier = new Promise<void>(resolve => release = resolve);
    const sql = new ProjectOpsConnectionSqlExecutor({ async query(text, params = []) {
      const result = await pool.query(text, [...params]);
      if (enabled && /^SELECT \*/.test(text) && text.includes('FROM projectops_project_requests') && params[0] === 'r') {
        waiting++; if (waiting === 2) release(); await barrier;
      }
      return { rows: result.rows, rowCount: result.rowCount ?? 0, command: result.command };
    } });
    const repo = new ProjectOpsRepository(sql);
    await repo.createClient({ id: 'c', name: 'Client', createdAtIso: time });
    await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Race', brief: 'Brief', createdAtIso: time });
    await repo.estimateProjectRequest('r', { amountCents: 100, currency: 'EUR', estimatedAtIso: time }); enabled = true;
    const results = await Promise.allSettled([
      repo.estimateProjectRequest('r', { amountCents: 200, currency: 'EUR', estimatedAtIso: time, expectedRevision: 2 }),
      repo.approveProjectRequest('r', { approvedBy: 'Operator', approvedAtIso: time, expectedRevision: 2 }),
    ]);
    enabled = false; assert.equal(waiting, 2);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.code, 'PROJECTOPS_PROJECT_CHANGED');
    const saved = await repo.getProjectRequest('r'); assert.equal(saved?.revision, 3);
    if (saved?.status === 'approved') { assert.equal(saved.estimateAmountCents, 100); assert.equal(saved.approvedBy, 'Operator'); }
    else { assert.equal(saved?.status, 'estimated'); assert.equal(saved.estimateAmountCents, 200); assert.equal(saved.approvedBy, undefined); }
  });
});
