import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
const time = '2026-10-03T12:00:00.000Z';
test('Estimates and lifecycle commands enforce metadata, revisions, hold and terminal states', async () => {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql); const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: time });
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Controls', brief: 'Brief', createdAtIso: time });
  await assert.rejects(() => repo.transitionProjectRequest('r', 'estimated', time), /estimate or approval command/);
  await assert.rejects(() => repo.approveProjectRequest('r', { approvedBy: 'Operator', approvedAtIso: time }));
  await repo.estimateProjectRequest('r', { amountCents: 12345, currency: 'EUR', estimatedAtIso: time, expectedRevision: 1 });
  await assert.rejects(() => repo.estimateProjectRequest('r', { amountCents: 500, currency: 'USD', estimatedAtIso: time, expectedRevision: 1 }), /Reload/);
  const revised = await repo.estimateProjectRequest('r', { amountCents: 15000, currency: 'EUR', estimatedAtIso: time, expectedRevision: 2 });
  assert.equal(revised.revision, 3);
  await repo.approveProjectRequest('r', { approvedBy: 'Operator', approvedAtIso: time, expectedRevision: 3 });
  await assert.rejects(() => repo.estimateProjectRequest('r', { amountCents: 500, currency: 'USD', estimatedAtIso: time, expectedRevision: 4 }));
  await repo.transitionProjectRequest('r', 'in_progress', time, 4);
  await repo.transitionProjectRequest('r', 'on_hold', time, 5);
  await assert.rejects(() => repo.transitionProjectRequest('r', 'delivered', time, 6));
  await repo.transitionProjectRequest('r', 'in_progress', time, 6);
  await repo.transitionProjectRequest('r', 'cancelled', time, 7);
  await assert.rejects(() => repo.editProject('r', { title: 'Change', brief: 'Brief', priority: 'low', expectedRevision: 8 }, time), /cancelled/);
  const archived = await repo.transitionProjectRequest('r', 'archived', time, 8);
  assert.equal(archived.estimateAmountCents, 15000); assert.equal(archived.approvedBy, 'Operator'); assert.equal(archived.revision, 9);
});
test('HTTP control actions reject bypass, invalid actions, stale decisions and terminal child writes', async () => {
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0, clock: () => time });
  const send = (path: string, body: unknown) => fetch(app.server.origin + '/projectops/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await send('clients', { id: 'c', name: 'Client' }); await send('project-requests', { id: 'r', clientId: 'c', title: 'Controls', brief: 'Brief' });
    const root = 'project-requests/r';
    for (const status of ['estimated', 'approved']) assert.equal((await send(root + '/status', { status })).status, 400);
    for (const body of [{ action: 'cancel' }, { action: '__proto__', expectedRevision: 1 }, { action: 'resume', expectedRevision: 1 }]) assert.equal((await send(root + '/control', body)).status, 400);
    assert.equal((await send(root + '/estimate', { amountCents: 0, currency: 'USD', expectedRevision: 1 })).status, 400);
    const race = await Promise.all([send(root + '/estimate', { amountCents: 100, currency: 'EUR', expectedRevision: 1 }), send(root + '/control', { action: 'cancel', expectedRevision: 1 })]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    let current = await fetch(app.server.origin + '/projectops/' + root).then(r => r.json());
    if (current.status !== 'cancelled') { assert.equal((await send(root + '/control', { action: 'cancel', expectedRevision: current.revision })).status, 200); current = await fetch(app.server.origin + '/projectops/' + root).then(r => r.json()); }
    assert.equal((await send(root + '/notes', { id: 'n', author: 'Operator', body: 'Blocked' })).status, 409);
    assert.equal((await send(root + '/control', { action: 'archive', expectedRevision: current.revision })).status, 200);
  } finally { await app.close(); }
});
