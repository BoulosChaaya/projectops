import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore, hashOperatorToken } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';

test('Operator migration upgrades an existing baseline without losing client records', async () => {
  await operatorFixture(async (_url, pool) => {
    const migrations = await loadProjectOpsPostgresMigrations();
    const client = await pool.connect();
    try {
      await migrateProjectOpsPostgres(client, migrations.slice(0, 1));
      await client.query("INSERT INTO projectops_clients (id, name, status, created_at) VALUES ('existing', 'Existing client', 'active', NOW())");
      assert.deepEqual(await migrateProjectOpsPostgres(client, migrations), ['0002', '0003']);
      assert.equal((await client.query("SELECT name FROM projectops_clients WHERE id='existing'")).rows[0].name, 'Existing client');
    } finally { client.release(); }
  });
});

test('Durable operator access, defaults, expiry, revocation and rate limits', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const config = { databaseUrl, host: '127.0.0.1', port: 0 };
    let app = await startProjectOpsPostgresApp(config);
    const store = new ProjectOpsOperatorStore(pool);
    try {
      await store.provision('operator', 'acceptance-password');
      await assert.rejects(() => store.provision('replacement', 'replacement-password'));
      assert.match((await pool.query('SELECT password_hash FROM projectops_operator')).rows[0].password_hash, /^scrypt\$/);
      let origin = app.server.origin;
      const login = async (name = 'operator', password = 'acceptance-password') => {
        const r = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: name, password }) });
        return { response: r, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
      };
      assert.equal((await login('unknown')).response.status, 401);
      assert.equal((await login('operator', 'wrong-password')).response.status, 401);
      const first = await login(); const second = await login();
      assert.equal(first.response.status, 200);
      assert.notEqual(first.cookie, second.cookie);
      assert.match(first.response.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
      const rawToken = first.cookie!.split('=')[1];
      const rows = (await pool.query('SELECT token_hash FROM projectops_operator_sessions')).rows;
      assert.ok(rows.some(r => r.token_hash === hashOperatorToken(rawToken)));
      assert.ok(rows.every(r => r.token_hash !== rawToken));
      const headers = () => ({ origin, cookie: first.cookie!, 'x-csrf-token': first.data.csrfToken, 'content-type': 'application/json' });
      const send = async (path: string, body: unknown, overrides: Record<string, string> = {}) => fetch(origin + path, { method: 'POST', headers: { ...headers(), ...overrides }, body: JSON.stringify(body) });
      assert.equal((await send('/projectops/access/settings', {}, { origin: 'https://evil.example' })).status, 403);
      assert.equal((await send('/projectops/access/settings', {}, { 'x-csrf-token': 'bad' })).status, 403);
      assert.equal((await send('/projectops/access/settings', { defaultCurrency: 'eur' })).status, 400);
      const defaults = { defaultCurrency: 'EUR', defaultPriority: 'high', timezone: 'Asia/Beirut' };
      assert.equal((await send('/projectops/access/settings', defaults)).status, 200);
      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      const persisted = await fetch(origin + '/projectops/access/session', { headers: headers() });
      assert.equal(persisted.status, 200); assert.deepEqual((await persisted.json()).defaults, defaults);
      assert.equal((await send('/projectops/clients', { id: 'c', name: 'Client' })).status, 200);
      const project = await send('/projectops/project-requests', { id: 'r', clientId: 'c', title: 'Title', brief: 'Brief' });
      assert.equal((await project.json()).priority, 'high');
      const estimate = await send('/projectops/project-requests/r/estimate', { amountCents: 5000 });
      assert.equal(estimate.status, 200); assert.equal((await estimate.json()).estimateCurrency, 'EUR');
      assert.equal((await send('/projectops/access/credentials', { currentPassword: 'wrong-password', newLogin: 'updated', newPassword: 'new-acceptance-password' })).status, 401);
      assert.equal((await send('/projectops/access/credentials', { currentPassword: 'acceptance-password', newLogin: 'updated', newPassword: 'new-acceptance-password' })).status, 200);
      assert.equal((await pool.query('SELECT * FROM projectops_operator_sessions')).rows.length, 0);
      for (const cookie of [first.cookie!, second.cookie!]) assert.equal((await fetch(origin + '/projectops/clients', { headers: { cookie } })).status, 401);
      assert.equal((await login()).response.status, 401);
      const updated = await login('updated', 'new-acceptance-password');
      assert.equal(updated.response.status, 200);
      assert.equal((await send('/projectops/access/logout', {}, { cookie: updated.cookie!, 'x-csrf-token': updated.data.csrfToken })).status, 200);
      assert.equal((await fetch(origin + '/projectops/clients', { headers: { cookie: updated.cookie! } })).status, 401);
      await pool.query("UPDATE projectops_login_limit SET attempts=0, window_start=NOW()");
      const expired = await login('updated', 'new-acceptance-password');
      await pool.query("UPDATE projectops_operator_sessions SET expires_at=NOW()-INTERVAL '1 second'");
      assert.equal((await fetch(origin + '/projectops/clients', { headers: { cookie: expired.cookie! } })).status, 401);
      const idle = await login('updated', 'new-acceptance-password');
      await pool.query("UPDATE projectops_operator_sessions SET last_seen_at=NOW()-INTERVAL '31 minutes'");
      assert.equal((await fetch(origin + '/projectops/clients', { headers: { cookie: idle.cookie! } })).status, 401);
      await pool.query("UPDATE projectops_login_limit SET attempts=0, window_start=NOW()");
      for (let i = 0; i < 10; i++) assert.equal((await login('updated', 'bad')).response.status, 401);
      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      const limited = await login('updated', 'new-acceptance-password');
      assert.equal(limited.response.status, 429); assert.equal(limited.response.headers.get('retry-after'), '60');
    } finally { await app.close(); }
  });
});
