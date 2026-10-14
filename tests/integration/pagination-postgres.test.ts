import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { selectClientsSql, selectProjectRequestsSql } from '../../packages/projectops/src/sql.ts';
import { clientPageCursor, projectRequestPageCursor } from '../../packages/projectops/src/pagination.ts';

// Creation times advance once every 7 records, so most records share a timestamp with others and
// only the id tiebreak orders them: the case where keyset pagination usually goes wrong.
const minute = (n: number) => new Date(Date.UTC(2026, 9, 3, 10, 0) + n * 60_000).toISOString();

async function session(databaseUrl: string, pool: any, clock: () => string) {
  const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, clock });
  await new ProjectOpsOperatorStore(pool).provision('operator', 'pagination-acceptance-password');
  const origin = app.server.origin;
  const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'operator', password: 'pagination-acceptance-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!; const csrf = (await login.json()).csrfToken;
  const headers = { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf };
  const send = (path: string, body: unknown) => fetch(origin + '/projectops/' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const get = (path: string) => fetch(origin + '/projectops/' + path, { headers });
  return { app, send, get };
}

async function pageThrough(get: (path: string) => Promise<Response>, path: string, limit: number,
  between?: (pageIndex: number) => Promise<void>) {
  const ids: string[] = []; const sizes: number[] = []; let cursor: string | null = null; let index = 0;
  do {
    const query = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    const response = await get(`${path}${path.includes('?') ? '&' : '?'}${query}`); assert.equal(response.status, 200);
    const page = await response.json() as { items: { id: string }[]; nextCursor: string | null };
    ids.push(...page.items.map(item => item.id)); sizes.push(page.items.length); cursor = page.nextCursor;
    if (between) await between(index++);
  } while (cursor);
  return { ids, sizes };
}

test('Client pages over real PostgreSQL visit every client once, in order, across timestamp ties and concurrent inserts', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    let tick = 0;
    const { app, send, get } = await session(databaseUrl, pool, () => minute(Math.floor(tick++ / 7)));
    try {
      for (let i = 0; i < 120; i++) assert.equal((await send('clients', { id: `client-${String(i).padStart(3, '0')}`, name: `Studio ${i}` })).status, 200);
      const expected = (await pool.query('SELECT id FROM projectops_clients ORDER BY created_at DESC, id ASC')).rows.map((r: { id: string }) => r.id);
      const ties = (await pool.query('SELECT count(*)::int AS n FROM (SELECT created_at FROM projectops_clients GROUP BY created_at HAVING count(*) > 1) t')).rows[0].n;
      assert.ok(ties >= 10, 'fixture must contain timestamp ties');

      const paged = await pageThrough(get, 'clients', 50);
      assert.deepEqual(paged.sizes, [50, 50, 20]);
      assert.deepEqual(paged.ids, expected);

      // A client created mid-way sorts before the cursor (newest first), so later pages neither
      // repeat a client nor shift by one, which OFFSET pagination would do.
      const withInsert = await pageThrough(get, 'clients', 40, async index => {
        if (index === 0) assert.equal((await send('clients', { id: 'inserted-mid-way', name: 'Inserted' })).status, 200);
      });
      assert.deepEqual(withInsert.ids, expected);
      assert.equal(new Set(withInsert.ids).size, withInsert.ids.length);

      const filtered = await pageThrough(get, 'clients?status=active&q=studio%201', 7);
      const expectedFiltered = (await pool.query(`SELECT id FROM projectops_clients WHERE status = 'active'
        AND strpos(lower(name), 'studio 1') > 0 ORDER BY created_at DESC, id ASC`)).rows.map((r: { id: string }) => r.id);
      assert.deepEqual(filtered.ids, expectedFiltered);
    } finally { await app.close(); }
  });
});

test('Invalid limits and cursors are rejected with 400 before touching the query', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const { app, get } = await session(databaseUrl, pool, () => minute(0));
    try {
      for (const limit of ['0', '101', '-1', 'abc', '1e2', '0x10', '', '10000']) {
        const response = await get(`clients?limit=${encodeURIComponent(limit)}`);
        assert.equal(response.status, 400, `limit=${limit}`);
        assert.equal((await response.json()).code, 'INVALID_PAGE_LIMIT');
      }
      const projectsCursor = projectRequestPageCursor({ updatedAtIso: minute(1), createdAtIso: minute(1), id: 'p' });
      for (const cursor of ['garbage!', 'eyJ2IjoxfQ', projectsCursor]) {
        const response = await get(`clients?cursor=${encodeURIComponent(cursor)}`);
        assert.equal(response.status, 400, `cursor=${cursor}`);
        assert.equal((await response.json()).code, 'INVALID_PAGE_CURSOR');
      }
      const clientsCursor = clientPageCursor({ createdAtIso: minute(1), id: 'c' });
      assert.equal((await get(`project-requests?cursor=${encodeURIComponent(clientsCursor)}`)).status, 400);
      assert.equal((await get('clients?limit=100')).status, 200);
    } finally { await app.close(); }
  });
});

test('Project pages follow updated, created, id order over real PostgreSQL', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    let tick = 0;
    const { app, send, get } = await session(databaseUrl, pool, () => minute(Math.floor(tick++ / 9)));
    try {
      assert.equal((await send('clients', { id: 'c', name: 'Client' })).status, 200);
      for (let i = 0; i < 60; i++) assert.equal((await send('project-requests', { id: `p-${String(i).padStart(2, '0')}`, clientId: 'c', title: `Project ${i}`, brief: 'Brief' })).status, 200);
      const expected = (await pool.query('SELECT id FROM projectops_project_requests ORDER BY updated_at DESC, created_at DESC, id ASC')).rows.map((r: { id: string }) => r.id);
      const paged = await pageThrough(get, 'project-requests', 25);
      assert.deepEqual(paged.sizes, [25, 25, 10]);
      assert.deepEqual(paged.ids, expected);
    } finally { await app.close(); }
  });
});

test('Generated page queries use the pagination indexes instead of sorting the table', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const { app } = await session(databaseUrl, pool, () => minute(0));
    try {
      await pool.query(`INSERT INTO projectops_clients(id, name, status, created_at, revision)
        SELECT 'bulk-' || g, 'Bulk ' || g, 'active', timestamptz '2026-10-03T10:00:00Z' - g * interval '1 second', 1 FROM generate_series(1, 5000) g`);
      await pool.query(`INSERT INTO projectops_project_requests(id, client_id, title, brief, priority, status, created_at, updated_at, revision)
        SELECT 'bulk-p-' || g, 'bulk-1', 'P' || g, 'B', 'medium', 'new', timestamptz '2026-10-03T10:00:00Z' - g * interval '1 second',
          timestamptz '2026-10-03T10:00:00Z' - (g % 500) * interval '1 second', 1 FROM generate_series(1, 5000) g`);
      await pool.query('ANALYZE projectops_clients; ANALYZE projectops_project_requests');
      const plan = async (statement: { sql: string; params: readonly unknown[] }) =>
        (await pool.query(`EXPLAIN ${statement.sql}`, [...statement.params])).rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
      const after = { createdAtIso: '2026-10-03T09:00:00.000Z', id: 'bulk-2500' };
      for (const statement of [
        selectClientsSql({ q: '', status: 'all' }, { limit: 50 }),
        selectClientsSql({ q: '', status: 'all' }, { limit: 50, after }),
      ]) assert.match(await plan(statement), /Index Scan using projectops_clients_created_id_idx/);
      for (const statement of [
        selectProjectRequestsSql({ limit: 50 }),
        selectProjectRequestsSql({ limit: 50, after: { updatedAtIso: '2026-10-03T09:55:00.000Z', createdAtIso: '2026-10-03T09:00:00.000Z', id: 'bulk-p-2500' } }),
      ]) assert.match(await plan(statement), /Index Scan using projectops_project_requests_updated_created_id_idx/);
    } finally { await app.close(); }
  });
});
