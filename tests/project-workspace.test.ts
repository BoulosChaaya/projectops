import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { projectSections, renderProjectPage } from '../apps/web/src/projectops/project-page.ts';

const time = '2026-10-03T10:00:00.000Z';
const later = '2026-10-03T11:00:00.000Z';
const input = { title: 'Edited', brief: 'Updated brief', budgetRange: 'USD 200-500', priority: 'high' as const, deadlineIso: '2026-11-01T12:00:00.000Z', expectedRevision: 1 };

test('Project edits validate details, clear optional fields, preserve workflow metadata and reject stale/archived writes', async () => {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql); const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: time });
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Original', brief: 'Original brief', priority: 'low', createdAtIso: time });
  const edited = await repo.editProject('r', input, later);
  assert.equal(edited.revision, 2); assert.equal(edited.priority, 'high'); assert.equal(edited.deadlineIso, input.deadlineIso);
  assert.equal(edited.status, 'new'); assert.equal(edited.createdAtIso, time); assert.equal(edited.clientId, 'c');
  await assert.rejects(() => repo.editProject('r', input, later), /Reload/);
  for (const patch of [{ title: '' }, { brief: ' ' }, { priority: 'urgent' }, { deadlineIso: 'invalid' }, { deadlineIso: '2025-01-01T00:00:00.000Z' }]) {
    await assert.rejects(() => repo.editProject('r', { ...input, expectedRevision: 2, ...patch } as any, later));
  }
  await repo.estimateProjectRequest('r', { amountCents: 10000, currency: 'EUR', estimatedAtIso: later });
  await assert.rejects(() => repo.editProject('r', { ...input, expectedRevision: 2 }, later), /Reload/);
  const cleared = await repo.editProject('r', { title: 'Final', brief: 'Keep metadata', priority: 'medium', expectedRevision: 3 }, later);
  assert.equal(cleared.budgetRange, undefined); assert.equal(cleared.deadlineIso, undefined); assert.equal(cleared.estimateCurrency, 'EUR'); assert.equal(cleared.status, 'estimated');
  await repo.approveProjectRequest('r', { approvedBy: 'Operator', approvedAtIso: later });
  await repo.createProjectDeliverable('r', { id: 'delivery', projectRequestId: 'r', title: 'Delivery', artifactUrl: 'https://example.test/artifact', submittedAtIso: later });
  await repo.acceptProjectDeliverable('r', 'delivery', later);
  for (const status of ['in_progress', 'delivered', 'archived'] as const) await repo.transitionProjectRequest('r', status, later);
  await assert.rejects(() => repo.editProject('r', { ...input, expectedRevision: 8 }, later), /archived/);
  await assert.rejects(() => repo.editProject('missing', input, later), /not found/);
});

test('Project workspace exposes all section links and HTTP editing rejects invalid and stale inputs', async () => {
  const page = renderProjectPage();
  assert.match(page.headers['content-security-policy'], /script-src 'nonce-/);
  for (const section of projectSections) assert.ok(String(page.body).includes(`href="#${section.path}"`));
  assert.equal(projectSections.length, 13);
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0, clock: () => later });
  const send = (path: string, body: unknown, method = 'POST') => fetch(app.server.origin + '/projectops/' + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await send('clients', { id: 'c', name: 'Client' });
    await send('project-requests', { id: 'r', clientId: 'c', title: 'Original', brief: 'Brief' });
    assert.equal((await send('project-requests/r', { ...input, priority: undefined }, 'PUT')).status, 400);
    assert.equal((await send('project-requests/r', input, 'PUT')).status, 200);
    assert.equal((await send('project-requests/r', input, 'PUT')).status, 409);
    assert.equal((await send('project-requests/missing', input, 'PUT')).status, 404);
    const result = await fetch(app.server.origin + '/projectops/projects/r'); assert.equal(result.status, 200);
    assert.match(await result.text(), /Edit project details/);
  } finally { await app.close(); }
});
