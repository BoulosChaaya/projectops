import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import {
  loadProjectOpsPostgresMigrations,
  migrateProjectOpsPostgres,
} from '../../packages/projectops/src/postgres-migrations.ts';

const databaseUrl = process.env.PROJECTOPS_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('PROJECTOPS_TEST_DATABASE_URL is required; PostgreSQL acceptance cannot be skipped.');
const T0 = '2026-10-03T08:00:00.000Z';
const T1 = '2026-10-03T09:00:00.000Z';
const T2 = '2026-10-03T10:00:00.000Z';

async function fixture(run: (url: string, pool: Pool) => Promise<void>): Promise<void> {
  const schema = `projectops_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.toString() });
  try { await run(url.toString(), pool); }
  finally {
    await pool.end();
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
  }
}

const sessions = new Map<string, Record<string, string>>();

async function post(origin: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...sessions.get(origin) }, body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

test('PostgreSQL application persists API data across shutdown and restart', async () => {
  await fixture(async (url, pool) => {
    const config = { databaseUrl: url, host: '127.0.0.1', port: 0 };
    let app = await startProjectOpsPostgresApp(config);
    try {
      const origin = app.server.origin;
      await new ProjectOpsOperatorStore(pool).provision('operator', 'acceptance-password');
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'acceptance-password' }) });
      assert.equal(login.status, 200);
      const session = { cookie: login.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': (await login.json()).csrfToken };
      sessions.set(origin, session);
      assert.equal((await fetch(`${origin}/health/ready`)).status, 200);
      await post(origin, '/projectops/clients', { id: 'client-1', name: 'Restart client', createdAtIso: T0 });
      await post(origin, '/projectops/project-requests', {
        id: 'req-1', clientId: 'client-1', title: 'Durable project', brief: 'Prove PostgreSQL persistence',
        priority: 'high', createdAtIso: T0,
      });
      const root = '/projectops/project-requests/req-1';
      await post(origin, `${root}/estimate`, { amountCents: 10000, currency: 'USD', estimatedAtIso: T1 });
      await post(origin, `${root}/approve`, { approvedBy: 'Operator', approvedAtIso: T2 });
      await post(origin, `${root}/milestones`, { id: 'ms-1', title: 'Delivery', createdAtIso: T2 });
      await post(origin, `${root}/tasks`, { id: 'task-1', title: 'Build', priority: 'high', createdAtIso: T2 });
      await post(origin, `${root}/risks`, {
        id: 'risk-1', title: 'Late assets', description: 'Assets may be late', probability: 'high',
        impact: 'medium', owner: 'Operator', identifiedAtIso: T2,
      });
      await post(origin, `${root}/invoices`, {
        id: 'invoice-1', invoiceNumber: 'INV-1', amountCents: 10000, currency: 'USD', issuedAtIso: T2,
      });
      await app.close();
      app = await startProjectOpsPostgresApp(config);
      sessions.set(app.server.origin, session);
      const persisted = await fetch(`${app.server.origin}${root}`, { headers: session }).then(r => r.json());
      assert.equal(persisted.status, 'approved');
      assert.equal(persisted.estimateAmountCents, 10000);
      assert.equal(persisted.approvedAtIso, T2);
      for (const collection of ['milestones', 'tasks', 'risks', 'invoices']) {
        const rows = await fetch(`${app.server.origin}${root}/${collection}`, { headers: session }).then(r => r.json());
        assert.equal(rows.length, 1, collection);
      }
      const summary = await fetch(`${app.server.origin}/projectops/dashboard`, { headers: session }).then(r => r.json());
      assert.equal(summary.totalActiveRequests, 1);
      assert.equal(summary.openRisks, 1);
      assert.equal(summary.outstandingInvoiceAmountCents, 10000);
      const html = await fetch(`${app.server.origin}/projectops`, { headers: session }).then(r => r.text());
      assert.match(html, /Durable project/);
      assert.equal((await pool.query('SELECT * FROM projectops_schema_migrations')).rows.length, 5);
    } finally { await app.close(); }
  });
});

test('PostgreSQL migrations serialize startup, apply upgrades once and reject drift', async () => {
  await fixture(async (_url, pool) => {
    const baseline = await loadProjectOpsPostgresMigrations();
    const upgrade = { version: '0006', name: 'acceptance_probe', upSql: 'CREATE TABLE upgrade_probe (id INTEGER PRIMARY KEY)' };
    const run = async () => {
      const client = await pool.connect();
      try { return await migrateProjectOpsPostgres(client, [...baseline, upgrade]); }
      finally { client.release(); }
    };
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.flat().sort(), ['0001', '0002', '0003', '0004', '0005', '0006']);
    assert.equal((await pool.query('SELECT * FROM projectops_schema_migrations')).rows.length, 6);
    const client = await pool.connect();
    try {
      await assert.rejects(() => migrateProjectOpsPostgres(client, [
        ...baseline, { ...upgrade, upSql: `${upgrade.upSql}; SELECT 1` },
      ]), /changed/);
      await assert.rejects(() => migrateProjectOpsPostgres(client, baseline), /Unknown/);
      assert.equal((await client.query('SELECT 1 AS ok')).rows[0].ok, 1);
    } finally { client.release(); }
  });
});

test('Failed PostgreSQL migration rolls back schema and ledger together', async () => {
  await fixture(async (_url, pool) => {
    const baseline = await loadProjectOpsPostgresMigrations();
    const client = await pool.connect();
    try {
      await migrateProjectOpsPostgres(client, baseline);
      await assert.rejects(() => migrateProjectOpsPostgres(client, [...baseline, {
        version: '0006', name: 'broken_probe',
        upSql: 'CREATE TABLE rollback_probe (id INTEGER); SELECT * FROM missing_probe_table',
      }]));
      assert.equal((await client.query("SELECT to_regclass('rollback_probe') AS probe")).rows[0].probe, null);
      assert.equal((await client.query('SELECT * FROM projectops_schema_migrations')).rows.length, 5);
    } finally { client.release(); }
  });
});

test('PostgreSQL startup refuses an unmanaged legacy schema', async () => {
  await fixture(async (_url, pool) => {
    await pool.query('CREATE TABLE projectops_clients (id TEXT PRIMARY KEY)');
    const client = await pool.connect();
    try {
      await assert.rejects(() => migrateProjectOpsPostgres(client, []), /Unmanaged/);
      assert.equal((await client.query("SELECT to_regclass('projectops_schema_migrations') AS ledger")).rows[0].ledger, null);
    } finally { client.release(); }
  });
});
