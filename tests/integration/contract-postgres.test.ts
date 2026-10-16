import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { startProjectOpsApp } from '../../apps/api/src/projectops/app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { ProjectOpsMemorySqlExecutor } from '../../packages/projectops/src/index.ts';

// The API contract is camelCase domain objects. PostgreSQL returns snake_case column names; the
// executor must translate them and never pass raw columns through, or every response carries two
// shapes (contact_name and contactName) and exposes internal column names.
const T0 = '2026-10-03T10:00:00.000Z';
const DUE = '2026-12-01T12:00:00.000Z';
const BACKDATED = '2020-01-01T00:00:00.000Z';
const P = 'project-requests/p1';
// Map keys that are workflow status values, not column names.
const STATUS_VALUE_KEYS = new Set(['in_progress', 'on_hold']);
const isSnakeCase = (key: string) => /^[a-z]+(_[a-z0-9]+)+$/.test(key) && !STATUS_VALUE_KEYS.has(key);
// Transport fields that must never appear inside a JSON body.
const TRANSPORT_KEYS = new Set(['headers']);

type Call = { method: 'GET' | 'POST'; path: string; body?: unknown };
// Creates one record of every entity type. Works with or without an operator session.
const creates: Call[] = [
  { method: 'POST', path: 'clients', body: { id: 'c1', name: 'Cedar Labs', contactName: 'Rania', email: 'rania@cedar.test' } },
  { method: 'POST', path: 'project-requests', body: { id: 'p1', clientId: 'c1', title: 'Website', brief: 'Brief', budgetRange: 'EUR 4-5k', deadlineIso: DUE, priority: 'high' } },
  { method: 'POST', path: `${P}/estimate`, body: { amountCents: 450000, currency: 'EUR' } },
  { method: 'POST', path: `${P}/approve`, body: { approvedBy: 'Operator' } },
  { method: 'POST', path: `${P}/milestones`, body: { id: 'm1', title: 'Design', dueAtIso: DUE } },
  { method: 'POST', path: `${P}/tasks`, body: { id: 't1', title: 'Wireframes', priority: 'high', dueAtIso: DUE, description: 'D', assignee: 'A' } },
  { method: 'POST', path: `${P}/work-logs`, body: { id: 'w1', actor: 'Operator', minutes: 30, note: 'Work', taskId: 't1' } },
  { method: 'POST', path: `${P}/notes`, body: { id: 'n1', author: 'Operator', body: 'Kickoff' } },
  { method: 'POST', path: `${P}/documents`, body: { id: 'd1', title: 'Spec', url: 'https://example.test/spec', documentType: 'proposal', uploadedBy: 'Operator' } },
  { method: 'POST', path: `${P}/issues`, body: { id: 'i1', title: 'Font', description: 'Licence', owner: 'Operator' } },
  { method: 'POST', path: `${P}/risks`, body: { id: 'r1', title: 'Delay', description: 'Late', probability: 'medium', impact: 'high', owner: 'Operator' } },
  { method: 'POST', path: `${P}/deliverables`, body: { id: 'v1', milestoneId: 'm1', title: 'Design file', artifactUrl: 'https://example.test/design' } },
  { method: 'POST', path: `${P}/feedback`, body: { id: 'f1', author: 'Rania', message: 'Looks good', deliverableId: 'v1' } },
  { method: 'POST', path: `${P}/invoices`, body: { id: 'inv1', invoiceNumber: 'INV-1', amountCents: 450000, currency: 'EUR', dueAtIso: DUE } },
  { method: 'POST', path: `${P}/expenses`, body: { id: 'e1', description: 'Photos', amountCents: 9900, currency: 'USD', vendor: 'Stock Co' } },
  { method: 'POST', path: `${P}/change-requests`, body: { id: 'cr1', title: 'Blog', description: 'Extra', requestedBy: 'Rania' } },
  // The same entities with every optional field left empty.
  { method: 'POST', path: 'clients', body: { id: 'c2', name: 'Bare Studio' } },
  { method: 'POST', path: `${P}/tasks`, body: { id: 't2', title: 'Bare task' } },
  { method: 'POST', path: `${P}/milestones`, body: { id: 'm2', title: 'Bare milestone' } },
  { method: 'POST', path: `${P}/work-logs`, body: { id: 'w2', actor: 'Operator', minutes: 5 } },
  { method: 'POST', path: `${P}/notes`, body: { id: 'n2', author: 'Operator', body: 'Bare note' } },
  { method: 'POST', path: `${P}/expenses`, body: { id: 'e2', description: 'Bare expense', amountCents: 100, currency: 'USD' } },
];
// Terminal actions fill the optional columns (resolution, decision, completion, archival).
const actions: Call[] = [
  { method: 'POST', path: `${P}/issues/i1/resolve`, body: { resolutionNote: 'Bought' } },
  { method: 'POST', path: `${P}/risks/r1/mitigate`, body: { mitigationNote: 'Buffer' } },
  // Who did it and when are the signed-in operator and the server clock; a body claiming otherwise is ignored.
  { method: 'POST', path: `${P}/notes/n1/archive`, body: { archivedBy: 'imposter', archivedAtIso: BACKDATED } },
  { method: 'POST', path: `${P}/documents/d1/archive`, body: { archivedBy: 'imposter', archivedAtIso: BACKDATED } },
  { method: 'POST', path: `${P}/tasks/t1/complete`, body: { completedBy: 'imposter', completedAtIso: BACKDATED, expectedRevision: 1 } },
  { method: 'POST', path: `${P}/change-requests/cr1/approve`, body: { decidedBy: 'imposter', decidedAtIso: BACKDATED } },
  { method: 'POST', path: `${P}/invoices/inv1/pay`, body: {} },
  { method: 'POST', path: `${P}/expenses/e1/approve`, body: { decisionNote: 'OK', decidedBy: 'Operator' } },
];
const reads: Call[] = ['clients', 'clients/c1', 'clients/c2', 'clients/c1/projects', 'project-requests', P, 'dashboard',
  ...['milestones', 'tasks', 'work-logs', 'notes', 'documents', 'issues', 'risks', 'deliverables', 'feedback', 'invoices', 'expenses', 'change-requests', 'activities']
    .map(collection => `${P}/${collection}`)].map(path => ({ method: 'GET' as const, path }));

function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap(item => keyPaths(item, `${prefix}[]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [`${prefix}${key}`, ...keyPaths(child, `${prefix}${key}.`)]);
}
// Keys whose value is null: an empty optional field is left out of a response, never null.
function nullKeyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap(item => nullKeyPaths(item, `${prefix}[]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => child === null ? [`${prefix}${key}`] : nullKeyPaths(child, `${prefix}${key}.`));
}

async function run(origin: string, headers: Record<string, string>, calls: Call[]) {
  const results: { call: Call; status: number; json: unknown }[] = [];
  for (const call of calls) {
    const response = await fetch(`${origin}/projectops/${call.path}`, { method: call.method, headers: { origin, 'content-type': 'application/json', ...headers },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }) });
    results.push({ call, status: response.status, json: await response.json() });
  }
  return results;
}

test('Every PostgreSQL-backed response uses camelCase domain fields only, with no raw columns or transport fields', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, clock: () => T0 });
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'contract-acceptance-password');
      const origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ login: 'operator', password: 'contract-acceptance-password' }) });
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!; const csrf = (await login.json()).csrfToken;
      const results = await run(origin, { cookie, 'x-csrf-token': csrf }, [...creates, ...actions, ...reads]);
      for (const { call, status, json } of results) {
        assert.equal(status, 200, `${call.method} ${call.path}: ${JSON.stringify(json)}`);
        const paths = keyPaths(json);
        const leaked = paths.filter(path => path.split(/\.|\[\]/).some(isSnakeCase));
        assert.deepEqual(leaked, [], `${call.method} ${call.path} leaks raw column names`);
        assert.ok(!paths.some(path => TRANSPORT_KEYS.has(path)), `${call.method} ${call.path} has a transport field in its body`);
      }
      // The optional columns filled by the actions must arrive under their camelCase names.
      const body = (path: string) => results.find(r => r.call.method === 'GET' && r.call.path === `${P}/${path}`)!.json as Record<string, unknown>[];
      assert.equal(body('issues')[0]!.resolutionNote, 'Bought');
      assert.equal(body('risks')[0]!.mitigationNote, 'Buffer');
      const trusted = (row: Record<string, unknown>, by: string, at: string) => assert.deepEqual([row[by], row[at]], ['operator', T0], `${by} and ${at}`);
      trusted(body('notes').find(row => row.id === 'n1')!, 'archivedBy', 'archivedAtIso');
      trusted(body('documents').find(row => row.id === 'd1')!, 'archivedBy', 'archivedAtIso');
      trusted(body('tasks').find(row => row.id === 't1')!, 'completedBy', 'completedAtIso');
      trusted(body('change-requests').find(row => row.id === 'cr1')!, 'decidedBy', 'decidedAtIso');
      assert.equal(body('expenses')[0]!.decisionNote, 'OK');
    } finally { await app.close(); }
  });
});

test('PostgreSQL and memory executors return the same response fields, so native tests see the production contract', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    // The memory app has no operator access; compare the runtime without access by reading
    // through repositories built on each executor behind the same unprotected application.
    const memory = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), host: '127.0.0.1', port: 0, clock: () => T0 });
    const postgres = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, clock: () => T0 });
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'contract-parity-password');
      const origin = postgres.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ login: 'operator', password: 'contract-parity-password' }) });
      const auth = { cookie: login.headers.get('set-cookie')!.split(';')[0]!, 'x-csrf-token': (await login.json()).csrfToken };
      // Activities depend on the signed-in operator (history records the actor), which the
      // memory harness has no session for, so the history endpoint and fields are compared elsewhere.
      const compared = [...creates, ...reads.filter(read => !read.path.endsWith('/activities'))];
      const [fromPostgres, fromMemory] = await Promise.all([run(origin, auth, compared), run(memory.server.origin, {}, compared)]);
      for (const [index, pg] of fromPostgres.entries()) {
        const mem = fromMemory[index]!;
        const label = `${pg.call.method} ${pg.call.path}`;
        assert.equal(pg.status, mem.status, label);
        const ignore = (path: string) => /(^|\.|\[\])latestActivity(AtIso|Summary)$/.test(path);
        assert.deepEqual(keyPaths(pg.json).filter(p => !ignore(p)).sort(), keyPaths(mem.json).filter(p => !ignore(p)).sort(), label);
        // A page's nextCursor is null on its last page by contract; record fields are never null.
        assert.deepEqual(nullKeyPaths(pg.json).filter(p => !ignore(p) && p !== 'nextCursor'), [], `${label}: empty optional fields are left out, not null`);
      }
    } finally { await Promise.all([memory.close(), postgres.close()]); }
  });
});
