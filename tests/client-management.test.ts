import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';

const time = '2026-10-03T10:00:00.000Z';
test('Client edits preserve identity, clear contacts, search literally, and reject stale writes', async () => {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Studio %_', contactName: 'Boulos', email: 'client@example.com', createdAtIso: time });
  const updated = await repo.editClient('c', { name: 'Updated studio %_', expectedRevision: 1 });
  assert.equal(updated.revision, 2); assert.equal(updated.contactName, undefined); assert.equal(updated.email, undefined);
  assert.equal(updated.createdAtIso, time); assert.equal(updated.id, 'c');
  await assert.rejects(() => repo.editClient('c', { name: 'Stale', expectedRevision: 1 }), /Reload/);
  assert.equal((await repo.listClients({ q: '%_' })).items.length, 1);
  assert.equal((await repo.listClients({ q: "' OR 1=1 --" })).items.length, 0);
  await assert.rejects(() => repo.listClients({ status: 'invalid' as any }));
  await assert.rejects(() => repo.editClient('c', { name: '', expectedRevision: 2 }));
  await assert.rejects(() => repo.editClient('c', { name: 'Good', email: 'invalid', expectedRevision: 2 }));
  await assert.rejects(() => repo.archiveClient('c', 0));
  await assert.rejects(() => repo.archiveClient('missing', 1), /not found/);
});

test('Archiving retains project history and prevents new projects and edits', async () => {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: time });
  await repo.createClient({ id: 'other', name: 'Other', createdAtIso: time });
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'History', brief: 'Retain', priority: 'low', createdAtIso: time });
  await repo.createProjectRequest({ id: 'other-r', clientId: 'other', title: 'Unrelated', brief: 'Other', priority: 'low', createdAtIso: time });
  assert.equal((await repo.archiveClient('c', 1)).status, 'archived');
  assert.deepEqual((await repo.listClientProjects('c')).map(r => r.id), ['r']);
  assert.equal((await repo.listClients({ status: 'archived' })).items.length, 1);
  assert.equal((await repo.listClients({ status: 'active' })).items.length, 1);
  await assert.rejects(() => repo.createProjectRequest({ id: 'blocked', clientId: 'c', title: 'Blocked', brief: 'Blocked', priority: 'low', createdAtIso: time }), /Archived/);
  await assert.rejects(() => repo.editClient('c', { name: 'Blocked', expectedRevision: 2 }), /archived/);
});

test('Client HTTP validation, conflicts, missing resources and protected-page markup', async () => {
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0 });
  const origin = app.server.origin;
  const send = (path: string, body: unknown, method = 'POST') => fetch(origin + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await send('/projectops/clients', { id: 'c', name: 'Client' })).status, 200);
    assert.equal((await send('/projectops/clients/c', { name: 'Updated' }, 'PUT')).status, 400);
    assert.equal((await send('/projectops/clients/c', { name: 'Updated', expectedRevision: 1 }, 'PUT')).status, 200);
    assert.equal((await send('/projectops/clients/c/archive', { expectedRevision: 1 })).status, 409);
    assert.equal((await send('/projectops/clients/missing/archive', { expectedRevision: 1 })).status, 404);
    assert.equal((await fetch(origin + '/projectops/clients/missing/projects')).status, 404);
    assert.equal((await fetch(origin + '/projectops/clients?status=invalid')).status, 400);
    const page = await fetch(origin + '/projectops/client-management');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.match(await page.text(), /Create client/);
  } finally { await app.close(); }
});
