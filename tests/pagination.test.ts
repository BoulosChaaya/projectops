import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations,
  clientPageCursor, projectRequestPageCursor, toPage, validateClientPage, validatePageLimit, validateProjectRequestPage,
  type Page,
} from '../packages/projectops/src/index.ts';

const T = (minute: number) => `2026-10-03T10:${String(minute).padStart(2, '0')}:00.000Z`;
const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const rejectsCursor = (fn: () => unknown, label: string) =>
  assert.throws(fn, (error: { code?: string }) => error.code === 'INVALID_PAGE_CURSOR', label);

test('Page limits default to 50, accept 1..100 integers and reject everything else', () => {
  assert.equal(DEFAULT_PAGE_LIMIT, 50); assert.equal(MAX_PAGE_LIMIT, 100);
  assert.equal(validatePageLimit(undefined), 50);
  for (const ok of [1, 37, 100]) assert.equal(validatePageLimit(ok), ok);
  for (const bad of [0, -1, 101, 1.5, Number.NaN, Infinity, '5', null]) {
    assert.throws(() => validatePageLimit(bad), (error: { code?: string }) => error.code === 'INVALID_PAGE_LIMIT', String(bad));
  }
});

test('Cursors round-trip and stay bound to their list', () => {
  const client = { createdAtIso: T(5), id: 'client-7' };
  assert.deepEqual(validateClientPage({ cursor: clientPageCursor(client) }), { limit: 50, after: client });
  const project = { updatedAtIso: T(9), createdAtIso: T(1), id: 'p.1:x' };
  assert.deepEqual(validateProjectRequestPage({ limit: 3, cursor: projectRequestPageCursor(project) }), { limit: 3, after: project });
  rejectsCursor(() => validateProjectRequestPage({ cursor: clientPageCursor(client) }), 'clients cursor replayed on projects');
  rejectsCursor(() => validateClientPage({ cursor: projectRequestPageCursor(project) }), 'projects cursor replayed on clients');
});

test('Forged or damaged cursors are rejected, never interpreted', () => {
  const good = { v: 1, list: 'clients', keys: [T(5), 'c'] };
  const cases: [string, string][] = [
    ['', 'empty'],
    ['x'.repeat(513), 'over 512 characters'],
    ['abc+/=', 'not base64url'],
    [Buffer.from('not json').toString('base64url'), 'not JSON'],
    [encode('a string'), 'not an object'],
    [encode(null), 'null'],
    [encode({ ...good, v: 2 }), 'unknown version'],
    [encode({ ...good, keys: [T(5)] }), 'too few keys'],
    [encode({ ...good, keys: [T(5), 'c', 'extra'] }), 'too many keys'],
    [encode({ ...good, keys: ['2026-10-03T10:05:00Z', 'c'] }), 'timestamp without milliseconds'],
    [encode({ ...good, keys: ['2026-10-03', 'c'] }), 'date only'],
    [encode({ ...good, keys: ['yesterday', 'c'] }), 'not a timestamp'],
    [encode({ ...good, keys: [12345, 'c'] }), 'numeric timestamp'],
    [encode({ ...good, keys: [T(5), 'has space'] }), 'invalid identifier'],
    [encode({ ...good, keys: [T(5), "c' OR '1'='1"] }), 'injection-shaped identifier'],
    [encode({ ...good, keys: [T(5), 'a'.repeat(201)] }), 'identifier too long'],
  ];
  for (const [cursor, label] of cases) rejectsCursor(() => validateClientPage({ cursor }), label);
});

test('toPage returns a cursor only when the extra row proves another page exists', () => {
  const rows = ['a', 'b', 'c'];
  assert.deepEqual(toPage(rows, 3, row => `after-${row}`), { items: rows, nextCursor: null });
  assert.deepEqual(toPage([...rows, 'd'], 3, row => `after-${row}`), { items: rows, nextCursor: 'after-c' });
  assert.deepEqual(toPage([], 3, row => `after-${row}`), { items: [], nextCursor: null });
});

async function collect<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<{ items: T[]; pages: number[] }> {
  const items: T[] = []; const pages: number[] = []; let cursor: string | undefined;
  do {
    const page = await read(cursor);
    items.push(...page.items); pages.push(page.items.length);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { items, pages };
}

test('Paging clients visits every match exactly once, in list order, across creation-time ties', async () => {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql);
  // Five clients share one creation time, so only the id tiebreak orders them.
  const ids = ['m', 'b', 'k', 'a', 'z', 'late-1', 'late-2', 'early'];
  const times = [T(5), T(5), T(5), T(5), T(5), T(9), T(9), T(1)];
  for (const [i, id] of ids.entries()) await repo.createClient({ id, name: `Studio ${id}`, createdAtIso: times[i]! });
  await repo.archiveClient('k', 1);

  const all = (await repo.listClients({}, { limit: 100 })).items.map(c => c.id);
  assert.deepEqual(all, ['late-1', 'late-2', 'a', 'b', 'k', 'm', 'z', 'early']);
  const paged = await collect(cursor => repo.listClients({}, { limit: 3, ...(cursor ? { cursor } : {}) }));
  assert.deepEqual(paged.items.map(c => c.id), all);
  assert.deepEqual(paged.pages, [3, 3, 2]);

  const active = await collect(cursor => repo.listClients({ status: 'active', q: 'studio' }, { limit: 2, ...(cursor ? { cursor } : {}) }));
  assert.deepEqual(active.items.map(c => c.id), all.filter(id => id !== 'k'));
});

test('Paging projects follows updated, created, id order and ends with a null cursor', async () => {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T(0) });
  for (const [id, minute] of [['p3', 2], ['p1', 2], ['p2', 2], ['p4', 7], ['p5', 1]] as const) {
    await repo.createProjectRequest({ id, clientId: 'c', title: id, brief: 'Brief', createdAtIso: T(minute) });
  }
  const all = (await repo.listProjectRequests({ limit: 100 })).items.map(p => p.id);
  assert.deepEqual(all, ['p4', 'p1', 'p2', 'p3', 'p5']);
  const paged = await collect(cursor => repo.listProjectRequests({ limit: 2, ...(cursor ? { cursor } : {}) }));
  assert.deepEqual(paged.items.map(p => p.id), all);
  assert.deepEqual(paged.pages, [2, 2, 1]);
});
