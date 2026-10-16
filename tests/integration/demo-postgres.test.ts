import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { ProjectOpsDemoSandboxes } from '../../packages/projectops/src/demo-sandboxes.ts';
import { loadProjectOpsPostgresMigrations } from '../../packages/projectops/src/postgres-migrations.ts';

type Visitor = { cookie: string; csrf: string };

async function http(origin: string, method: string, path: string, options: { visitor?: Visitor; body?: unknown } = {}) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.visitor) headers.cookie = options.visitor.cookie;
  if (method !== 'GET') { headers.origin = origin; headers['content-type'] = 'application/json'; if (options.visitor) headers['x-csrf-token'] = options.visitor.csrf; }
  const response = await fetch(origin + path, { method, headers, redirect: 'manual', ...(method === 'GET' ? {} : { body: JSON.stringify(options.body ?? {}) }) });
  const text = await response.text();
  let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: response.status, headers: response.headers, json, text };
}
const cookieOf = (response: { headers: Headers }) => response.headers.get('set-cookie')!.split(';')[0]!;

test('Demo sandboxes are private seeded copies: isolated from the operator and each other, capped, resettable and swept', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, demo: { maxLive: 3, maxPerWindow: 20, resetCooldownSeconds: 60 } });
    const origin = app.server.origin;
    const schemas = async () => (await pool.query(`SELECT nspname FROM pg_namespace WHERE nspname ~ '^demo_[a-f0-9]{24}$'`)).rows.map(row => row.nspname as string);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'demo-test-password');
      const signIn = await http(origin, 'POST', '/projectops/access/login', { body: { login: 'operator', password: 'demo-test-password' } });
      const operator: Visitor = { cookie: cookieOf(signIn), csrf: signIn.json.csrfToken };
      assert.equal((await http(origin, 'POST', '/projectops/clients', { visitor: operator, body: { id: 'operator-client', name: 'Operator private client' } })).status, 200);

      assert.deepEqual((await http(origin, 'GET', '/projectops/demo')).json, { enabled: true, lifetimeMinutes: 120 });
      // Starting a sandbox is a write: same-origin JSON only.
      assert.equal((await fetch(origin + '/projectops/demo/start', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
      const begin = async (): Promise<Visitor> => {
        const started = Date.now();
        const response = await http(origin, 'POST', '/projectops/demo/start');
        assert.equal(response.status, 200, response.text);
        assert.ok(Date.now() - started < 15_000, 'a sandbox is ready within seconds');
        assert.match(cookieOf(response), /^projectops_session=demo\.[A-Za-z0-9_-]{43}$/);
        assert.match(response.headers.get('set-cookie')!, /; Max-Age=7200(;|$)/);
        return { cookie: cookieOf(response), csrf: response.json.csrfToken };
      };
      const a = await begin();
      const names = async (visitor: Visitor) => (await http(origin, 'GET', '/projectops/clients?status=all', { visitor })).json.items.map((client: any) => client.name) as string[];

      // The seeded studio: every lifecycle state, money in two currencies, and history.
      const seeded = await names(a);
      assert.ok(seeded.includes('Harbor & Finch Bakery')); assert.ok(!seeded.includes('Operator private client'));
      const dashboard = (await http(origin, 'GET', '/projectops/dashboard', { visitor: a })).json;
      assert.equal(dashboard.rows.length, 6); assert.ok(dashboard.overdueWorkCount >= 1);
      assert.deepEqual(Object.keys(dashboard.financeTotalsByCurrency).sort(), ['EUR', 'USD']);
      assert.ok((await http(origin, 'GET', '/projectops/project-requests/bakery-ordering/activities', { visitor: a })).json.length > 30);
      const session = (await http(origin, 'GET', '/projectops/access/session', { visitor: a })).json;
      assert.equal(session.defaults.timezone, 'UTC', 'no timezone sent: UTC');
      // Two hours from start, by the database's clock (which decides expiry).
      const dbNow = Date.parse((await pool.query('SELECT NOW() AS now')).rows[0].now);
      assert.equal(session.login, 'demo'); assert.ok(Math.abs(Date.parse(session.demo.expiresAtIso) - dbNow - 120 * 60_000) < 60_000);
      assert.equal((await http(origin, 'GET', '/projectops/access/session', { visitor: operator })).json.demo, undefined);

      // A visitor's writes stay in their sandbox, recorded under "demo", through every route family.
      assert.equal((await http(origin, 'POST', '/projectops/clients', { visitor: a, body: { id: 'visitor-a', name: 'Visitor A client' } })).status, 200);
      const task = await http(origin, 'POST', '/projectops/project-requests/bakery-ordering/tasks', { visitor: a, body: { id: 'visitor-task', title: 'Visitor task' } });
      assert.equal(task.status, 200, task.text);
      const history = (await http(origin, 'GET', '/projectops/project-requests/bakery-ordering/activities', { visitor: a })).json;
      assert.ok(history.some((row: any) => row.eventType === 'task_created' && row.actor === 'demo' && row.summary.includes('visitor-task')));
      assert.equal((await http(origin, 'GET', '/projectops/project-requests/bakery-ordering/export', { visitor: a })).status, 200);
      assert.equal((await http(origin, 'GET', '/projectops/projects/bakery-ordering/delivery-summary', { visitor: a })).status, 200);
      // Read-only rule applies inside the sandbox too (the cancelled project).
      assert.equal((await http(origin, 'POST', '/projectops/project-requests/loyalty-prototype/notes', { visitor: a, body: { id: 'n', author: 'demo', body: 'x' } })).status, 409);
      // The operator sees none of it, and none of the seed.
      assert.deepEqual(await names(operator), ['Operator private client']);
      assert.equal((await http(origin, 'GET', '/projectops/project-requests/bakery-ordering', { visitor: operator })).status, 404);
      // A second visitor gets a fresh copy, without the first visitor's changes.
      // The visitor's browser timezone, when valid, is the sandbox's; anything else falls back to UTC.
      for (const [timezone, expected] of [['Asia/Beirut', 'Asia/Beirut'], ['Mars/Olympus', 'UTC'], [42, 'UTC']] as const) {
        const started = await http(origin, 'POST', '/projectops/demo/start', { body: { timezone } }); assert.equal(started.status, 200);
        const visitor = { cookie: cookieOf(started), csrf: started.json.csrfToken };
        assert.equal((await http(origin, 'GET', '/projectops/access/session', { visitor })).json.defaults.timezone, expected, String(timezone));
        assert.equal((await http(origin, 'POST', '/projectops/access/logout', { visitor })).status, 200);
      }
      const b = await begin();
      assert.ok(!(await names(b)).includes('Visitor A client')); assert.ok((await names(a)).includes('Visitor A client'));

      // Settings are the visitor's own; sign-in details cannot be changed from a sandbox.
      const saved = await http(origin, 'POST', '/projectops/access/settings', { visitor: a, body: { defaultCurrency: 'CHF', defaultPriority: 'high', timezone: 'Asia/Beirut' } });
      assert.equal(saved.status, 200);
      assert.equal((await http(origin, 'GET', '/projectops/access/session', { visitor: a })).json.defaults.defaultCurrency, 'CHF');
      assert.notEqual((await http(origin, 'GET', '/projectops/access/session', { visitor: operator })).json.defaults.defaultCurrency, 'CHF');
      const credentials = await http(origin, 'POST', '/projectops/access/credentials', { visitor: a, body: { currentPassword: 'x', newLogin: 'taken', newPassword: 'another-password-1' } });
      assert.equal(credentials.status, 403);
      assert.equal((await http(origin, 'POST', '/projectops/demo/reset', { visitor: operator })).status, 403);

      // Forged or unknown demo tokens are not sessions; an operator token never resolves to a sandbox.
      for (const cookie of ['projectops_session=demo.' + randomBytes(32).toString('base64url'), 'projectops_session=demo.short', 'projectops_session=' + 'demo.'.padEnd(48, 'A')]) {
        assert.equal((await http(origin, 'GET', '/projectops/clients', { visitor: { cookie, csrf: '' } })).status, 401, cookie);
      }

      // Capacity: three live sandboxes here; the fourth visitor is told to come back.
      await begin();
      const busy = await http(origin, 'POST', '/projectops/demo/start');
      assert.equal(busy.status, 503); assert.equal(busy.headers.get('retry-after'), '300'); assert.match(busy.json.message, /busy/);
      assert.equal((await schemas()).length, 3);

      // Reset: fresh seed in a new schema, the old one dropped, same expiry; not twice in a row.
      const before = new Set(await schemas());
      const expiry = (await http(origin, 'GET', '/projectops/access/session', { visitor: a })).json.demo.expiresAtIso;
      assert.equal((await http(origin, 'POST', '/projectops/demo/reset', { visitor: a })).status, 200);
      assert.ok(!(await names(a)).includes('Visitor A client')); assert.ok((await names(a)).includes('Harbor & Finch Bakery'));
      const after = new Set(await schemas());
      assert.equal(after.size, 3); assert.equal([...after].filter(schema => !before.has(schema)).length, 1);
      assert.equal((await http(origin, 'GET', '/projectops/access/session', { visitor: a })).json.demo.expiresAtIso, expiry);
      assert.equal((await http(origin, 'POST', '/projectops/demo/reset', { visitor: a })).status, 429);

      // Leaving deletes the sandbox at once.
      assert.equal((await http(origin, 'POST', '/projectops/access/logout', { visitor: a })).status, 200);
      assert.equal((await http(origin, 'GET', '/projectops/clients', { visitor: a })).status, 401);
      assert.equal((await schemas()).length, 2);

      // Expiry and the sweeper: an expired sandbox stops working and its schema is dropped, as is
      // any demo schema without a row (left by a crash).
      await pool.query(`UPDATE projectops_demo_sandboxes SET expires_at = NOW() - INTERVAL '1 second'
        WHERE schema_name = (SELECT schema_name FROM projectops_demo_sandboxes WHERE expires_at > NOW() ORDER BY created_at LIMIT 1)`);
      assert.equal((await http(origin, 'GET', '/projectops/clients', { visitor: b })).status, 401);
      const orphan = 'demo_' + randomBytes(12).toString('hex');
      await pool.query(`CREATE SCHEMA ${orphan}`);
      const sweeper = new ProjectOpsDemoSandboxes({ pool, migrations: await loadProjectOpsPostgresMigrations(), openBuildClient: async () => { throw Error('not used'); } });
      const dropped = await sweeper.sweep();
      assert.equal(dropped.length, 2); assert.ok(dropped.includes(orphan));
      assert.equal((await schemas()).length, 1);
      assert.deepEqual(await names(operator), ['Operator private client']);
    } finally { await app.close(); }
  });
});

test('A sandbox query never leaves its search_path on a pooled connection, and the sandbox cannot see the main schema', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, demo: true });
    try {
      const sandboxes = new ProjectOpsDemoSandboxes({ pool, migrations: await loadProjectOpsPostgresMigrations(), openBuildClient: async () => {
        const client = new Client({ connectionString: databaseUrl }); await client.connect(); return client;
      } });
      const started = await sandboxes.start(); assert.notEqual(started, 'busy');
      const session = (await sandboxes.resolve((started as { rawToken: string }).rawToken))!;
      const sandbox = sandboxes.executor(session.demo.schema);
      const main = (await pool.query('SHOW search_path')).rows[0].search_path;
      // Many sandbox statements and transactions over the shared pool, then the pool itself:
      // every pooled connection still has the main search_path.
      await Promise.all(Array.from({ length: 40 }, (_, i) => i % 2
        ? sandbox.query({ sql: 'SELECT 1 AS one', params: [] })
        : sandbox.transaction!(sql => sql.query({ sql: 'SELECT COUNT(*) AS n FROM projectops_clients', params: [] }))));
      const seen = await Promise.all(Array.from({ length: 30 }, () => pool.query('SHOW search_path').then(r => r.rows[0].search_path)));
      assert.ok(seen.every(path => path === main), JSON.stringify([...new Set(seen)]));
      assert.deepEqual((await sandbox.query<{ path: string }>({ sql: "SELECT current_setting('search_path') AS path", params: [] }))[0]!.path, session.demo.schema);
      // The main schema's tables are not on a sandbox's path: the operator table there is the
      // sandbox's own (empty), and the main schema cannot be named without its qualifier.
      assert.equal((await sandbox.query<{ n: string }>({ sql: 'SELECT COUNT(*) AS n FROM projectops_operator', params: [] }))[0]!.n, '0');
      await pool.query('CREATE TABLE main_only (secret TEXT)');
      await assert.rejects(() => sandbox.query({ sql: 'SELECT * FROM main_only', params: [] }), /main_only/);
      assert.throws(() => sandboxes.executor('public'), /Invalid demo sandbox schema/);
      assert.throws(() => sandboxes.executor('demo_x; DROP SCHEMA public'), /Invalid demo sandbox schema/);
    } finally { await app.close(); }
  });
});

test("A sandbox's changes are budgeted per minute and in total; reads, settings and the owner are not", async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, demo: { writesPerMinute: 3, writesPerSandbox: 5, resetCooldownSeconds: 0 } });
    try {
      const origin = app.server.origin;
      await new ProjectOpsOperatorStore(pool).provision('operator', 'demo-budget-password');
      const signIn = await http(origin, 'POST', '/projectops/access/login', { body: { login: 'operator', password: 'demo-budget-password' } });
      const operator: Visitor = { cookie: cookieOf(signIn), csrf: signIn.json.csrfToken };
      const begin = async (): Promise<Visitor> => { const r = await http(origin, 'POST', '/projectops/demo/start'); assert.equal(r.status, 200); return { cookie: cookieOf(r), csrf: r.json.csrfToken }; };
      let n = 0;
      const note = (visitor: Visitor) => http(origin, 'POST', '/projectops/project-requests/bakery-ordering/notes', { visitor, body: { id: `budget-${n++}`, author: 'demo', body: 'x' } });
      const a = await begin();
      for (let i = 0; i < 3; i++) assert.equal((await note(a)).status, 200);
      const limited = await note(a);
      assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.match(limited.json.message, /3 changes a minute/);
      // Reads, settings and the owner are not budgeted.
      assert.equal((await http(origin, 'GET', '/projectops/project-requests/bakery-ordering/notes', { visitor: a })).status, 200);
      assert.equal((await http(origin, 'POST', '/projectops/access/settings', { visitor: a, body: { defaultCurrency: 'EUR', defaultPriority: 'low', timezone: 'UTC' } })).status, 200);
      for (let i = 0; i < 6; i++) assert.equal((await http(origin, 'POST', '/projectops/clients', { visitor: operator, body: { id: `owner-${i}`, name: `Owner ${i}` } })).status, 200);
      // Budgets are per sandbox: a second visitor has their own.
      const b = await begin();
      assert.equal((await note(b)).status, 200);
      // The total: after a minute the rate allows more, until the sandbox's total is used.
      const minuteLater = Date.now() + 61_000;
      const realNow = Date.now;
      Date.now = () => minuteLater;
      try {
        assert.equal((await note(a)).status, 200); assert.equal((await note(a)).status, 200);
        const quota = await note(a);
        assert.equal(quota.status, 429); assert.match(quota.json.message, /made its 5 changes\. Reset the sample data/);
      } finally { Date.now = realNow; }
      // A reset replaces the data and starts the budget again.
      assert.equal((await http(origin, 'POST', '/projectops/demo/reset', { visitor: a })).status, 200);
      assert.equal((await note(a)).status, 200);
    } finally { await app.close(); }
  });
});

test('Leaving a sandbox still counts against the rate of new sandboxes', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, demo: { maxLive: 5, maxPerWindow: 2 } });
    try {
      const origin = app.server.origin;
      for (let i = 0; i < 2; i++) {
        const started = await http(origin, 'POST', '/projectops/demo/start'); assert.equal(started.status, 200);
        assert.equal((await http(origin, 'POST', '/projectops/access/logout', { visitor: { cookie: cookieOf(started), csrf: started.json.csrfToken } })).status, 200);
      }
      assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM pg_namespace WHERE nspname ~ '^demo_[a-f0-9]{24}$'`)).rows[0].n), 0, 'left sandboxes are gone');
      assert.equal((await http(origin, 'POST', '/projectops/demo/start')).status, 503, 'two starts in the window, even though both left');
    } finally { await app.close(); }
  });
});

test('Without PROJECTOPS_DEMO the demo is absent: no start, and demo-shaped tokens are not sessions', async () => {
  await operatorFixture(async (databaseUrl) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 });
    try {
      const origin = app.server.origin;
      assert.deepEqual((await http(origin, 'GET', '/projectops/demo')).json, { enabled: false });
      assert.equal((await fetch(origin + '/health/live')).headers.get('strict-transport-security'), null, 'plain-HTTP origin: no HSTS');
      const https = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, publicOrigin: 'https://projectops.example' });
      try { assert.equal((await fetch(https.server.origin + '/health/live')).headers.get('strict-transport-security'), 'max-age=31536000', 'HTTPS origin: HSTS'); }
      finally { await https.close(); }
      assert.equal((await http(origin, 'POST', '/projectops/demo/start')).status, 404);
      assert.equal((await http(origin, 'GET', '/projectops/clients', { visitor: { cookie: 'projectops_session=demo.' + randomBytes(32).toString('base64url'), csrf: '' } })).status, 401);
    } finally { await app.close(); }
  });
});
