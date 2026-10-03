import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';

test('Project upgrade, guarded editing, workflow metadata and clearing fields persist across restart', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const client = await pool.connect();
    try {
      await migrateProjectOpsPostgres(client, (await loadProjectOpsPostgresMigrations()).slice(0, 3));
      await client.query("INSERT INTO projectops_clients(id,name,status,created_at) VALUES('c','Client','active',NOW())");
      await client.query("INSERT INTO projectops_project_requests(id,client_id,title,brief,budget_range,priority,status,created_at,updated_at) VALUES('r','c','Legacy project','Brief','USD 200-500','low','new','2026-10-03T10:00:00Z','2026-10-03T10:00:00Z')");
    } finally { client.release(); }
    const config = { databaseUrl, host: '127.0.0.1', port: 0 }; let app = await startProjectOpsPostgresApp(config);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'workspace-acceptance-password');
      let origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'workspace-acceptance-password' }) });
      assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0]; const csrf = (await login.json()).csrfToken;
      const headers = () => ({ origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf });
      const send = (path: string, body: unknown, method = 'POST', overrides = {}) => fetch(origin + '/projectops/' + path, { method, headers: { ...headers(), ...overrides }, body: JSON.stringify(body) });
      const read = () => fetch(origin + '/projectops/project-requests/r', { headers: headers() }).then(r => r.json());
      assert.equal((await read()).revision, 1); assert.equal((await read()).budgetRange, 'USD 200-500');
      const input = { title: 'Edited', brief: 'Edited brief', budgetRange: 'EUR 100-300', priority: 'high', deadlineIso: '2026-11-01T12:00:00.000Z', expectedRevision: 1 };
      assert.equal((await send('project-requests/r', input, 'PUT', { 'x-csrf-token': '' })).status, 403);
      assert.equal((await send('project-requests/r', { ...input, deadlineIso: 'invalid' }, 'PUT')).status, 400);
      const edits = await Promise.all([send('project-requests/r', input, 'PUT'), send('project-requests/r', input, 'PUT')]);
      assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
      assert.equal((await send('project-requests/r/estimate', { amountCents: 5000, currency: 'EUR' })).status, 200);
      assert.equal((await send('project-requests/r/approve', { approvedBy: 'Operator' })).status, 200);
      assert.equal((await send('project-requests/r', { ...input, expectedRevision: 2 }, 'PUT')).status, 409);
      const current = await read(); assert.equal(current.revision, 4);
      assert.equal((await send('project-requests/r', { ...input, expectedRevision: 4, title: 'Final title' }, 'PUT')).status, 200);
      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      const saved = await read();
      assert.equal(saved.title, 'Final title'); assert.equal(saved.brief, input.brief); assert.equal(saved.budgetRange, input.budgetRange); assert.equal(saved.deadlineIso, input.deadlineIso);
      assert.equal(saved.status, 'approved'); assert.equal(saved.estimateAmountCents, 5000); assert.equal(saved.approvedBy, 'Operator'); assert.equal(saved.createdAtIso, '2026-10-03T10:00:00.000Z');
      assert.equal((await send('project-requests/r', { title: 'Cleared', brief: 'Clear optional fields', priority: 'low', expectedRevision: 5 }, 'PUT')).status, 200);
      const cleared = await read(); assert.equal(cleared.budgetRange, undefined); assert.equal(cleared.deadlineIso, undefined);
      for (const status of ['in_progress', 'delivered', 'archived']) assert.equal((await send('project-requests/r/status', { status })).status, 200);
      assert.equal((await send('project-requests/r', { ...input, expectedRevision: 9 }, 'PUT')).status, 409);
      assert.equal((await send('project-requests/missing', input, 'PUT')).status, 404);
    } finally { await app.close(); }
  });
});
