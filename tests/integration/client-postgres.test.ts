import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { ProjectOpsRepository } from '../../packages/projectops/src/repository.ts';
import { ProjectOpsConnectionSqlExecutor } from '../../packages/projectops/src/executor.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';

test('Client schema upgrade, search, revision conflicts and archive persist through restart', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const migrationClient = await pool.connect();
    try {
      await migrateProjectOpsPostgres(migrationClient, (await loadProjectOpsPostgresMigrations()).slice(0, 2));
      await migrationClient.query("INSERT INTO projectops_clients(id,name,status,created_at) VALUES('legacy','Legacy client','active',NOW())");
    } finally { migrationClient.release(); }
    const config = { databaseUrl, host: '127.0.0.1', port: 0 };
    let app = await startProjectOpsPostgresApp(config);
    try {
      assert.equal((await pool.query("SELECT revision FROM projectops_clients WHERE id='legacy'")).rows[0].revision, 1);
      await new ProjectOpsOperatorStore(pool).provision('operator', 'client-acceptance-password');
      let origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'client-acceptance-password' }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0]; const csrf = (await login.json()).csrfToken;
      const headers = () => ({ origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf });
      const send = (path: string, body: unknown, method = 'POST') => fetch(origin + '/projectops/' + path, { method, headers: headers(), body: JSON.stringify(body) });
      const get = (path: string) => fetch(origin + '/projectops/' + path, { headers: headers() });
      assert.equal((await send('clients', { id: 'c', name: 'Studio %_', contactName: 'Boulos', email: 'client@example.com' })).status, 200);
      const edits = await Promise.all(['First', 'Second'].map(name => send('clients/c', { name, expectedRevision: 1 }, 'PUT')));
      assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
      const edited = await (await get('clients/c')).json(); assert.equal(edited.revision, 2);
      assert.equal(edited.contactName, null); assert.equal(edited.email, null);
      assert.equal((await send('clients/c', { name: 'Studio %_', contactName: 'Boulos', email: 'client@example.com', expectedRevision: 2 }, 'PUT')).status, 200);
      for (const q of ['%_', 'bOuLoS', 'CLIENT@']) assert.equal((await (await get('clients?q=' + encodeURIComponent(q))).json()).length, 1);
      assert.equal((await (await get('clients?q=' + encodeURIComponent("' OR 1=1 --"))).json()).length, 0);
      assert.equal((await get('clients?status=invalid')).status, 400);
      assert.equal((await send('project-requests', { id: 'r', clientId: 'c', title: 'Existing project', brief: 'History' })).status, 200);
      const archive = await send('clients/c/archive', { expectedRevision: 3 }); assert.equal(archive.status, 200);
      assert.equal((await send('project-requests', { id: 'blocked', clientId: 'c', title: 'Blocked', brief: 'Blocked' })).status, 409);
      assert.equal((await send('clients/c', { name: 'Blocked', expectedRevision: 4 }, 'PUT')).status, 409);
      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      const persisted = await (await get('clients/c')).json(); assert.equal(persisted.status, 'archived'); assert.equal(persisted.revision, 4);
      assert.equal((await (await get('clients/c/projects')).json())[0].id, 'r');
      assert.equal((await (await get('clients?status=archived')).json()).length, 1);
      assert.equal((await (await get('clients?status=active')).json()).length, 1);
      assert.equal((await get('clients/missing/projects')).status, 404);
    } finally { await app.close(); }
  });
});

test('A project insert waiting on concurrent client archive cannot bypass the archive', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 });
    const sql = new ProjectOpsConnectionSqlExecutor({ async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await pool.query(text, [...params]); return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command };
    } });
    const repo = new ProjectOpsRepository(sql);
    const blocker = await pool.connect();
    try {
      await repo.createClient({ id: 'race', name: 'Race client', createdAtIso: new Date().toISOString() });
      await blocker.query('BEGIN');
      await blocker.query("UPDATE projectops_clients SET status='archived', revision=revision+1 WHERE id='race'");
      const insertion = repo.createProjectRequest({ id: 'race-project', clientId: 'race', title: 'Race', brief: 'Race', priority: 'low', createdAtIso: new Date().toISOString() }).then(value => value, error => error);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO projectops_project_requests%'")).rows;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(waiting, 'Project insertion must wait for the client row lock');
      await blocker.query('COMMIT');
      const result = await insertion; assert.equal(result.code, 'PROJECTOPS_CLIENT_ARCHIVED');
      assert.equal((await pool.query("SELECT * FROM projectops_project_requests WHERE id='race-project'")).rows.length, 0);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await app.close(); }
  });
});
