import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectOpsMemorySqlExecutor,
  ProjectOpsOperationError,
  ProjectOpsRepository,
  applyProjectOpsMigrations,
  createProjectMilestone,
  createProjectRequest,
  createProjectTask,
  requireMilestoneParentState,
  requireTaskParentState,
  type ProjectRequest,
} from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';

const T0 = '2026-10-03T12:00:00.000Z';
const T1 = '2026-10-04T12:00:00.000Z';
const T2 = '2026-10-05T12:00:00.000Z';
const T3 = '2026-10-06T12:00:00.000Z';

async function approvedRepository(): Promise<ProjectOpsRepository> {
  const sql = new ProjectOpsMemorySqlExecutor();
  await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Planning', brief: 'Brief', createdAtIso: T0 });
  await repo.estimateProjectRequest('r', { amountCents: 10000, currency: 'USD', estimatedAtIso: T0 });
  await repo.approveProjectRequest('r', { approvedBy: 'Operator', approvedAtIso: T0 });
  return repo;
}

test('Planning repository edits, reschedules, completes and reopens with child revisions', async () => {
  const repo = await approvedRepository();
  const milestone = await repo.createProjectMilestone('r', { id: 'm', projectRequestId: 'r', title: 'First milestone', dueAtIso: T2, createdAtIso: T0 });
  const task = await repo.createProjectTask('r', { id: 't', projectRequestId: 'r', title: 'First task', description: 'Description', assignee: 'A', priority: 'low', dueAtIso: T2, createdAtIso: T0 });
  assert.equal(milestone.revision, 1); assert.equal(task.revision, 1);

  const editedMilestone = await repo.editProjectMilestone('r', 'm', { title: 'Rescheduled milestone', dueAtIso: T3, expectedRevision: 1 }, T1);
  assert.equal(editedMilestone.revision, 2); assert.equal(editedMilestone.dueAtIso, T3);
  await assert.rejects(() => repo.editProjectMilestone('r', 'm', { title: 'Stale', expectedRevision: 1 }, T1), changed('PROJECTOPS_MILESTONE_CHANGED'));
  const completedMilestone = await repo.completeProjectMilestone('r', 'm', { completedAtIso: T2, expectedRevision: 2 });
  assert.equal(completedMilestone.revision, 3); assert.equal(completedMilestone.status, 'completed');
  await assert.rejects(() => repo.editProjectMilestone('r', 'm', { title: 'Blocked', expectedRevision: 3 }, T2), operation('PROJECTOPS_MILESTONE_NOT_OPEN'));
  const reopenedMilestone = await repo.reopenProjectMilestone('r', 'm', { reopenedAtIso: T3, expectedRevision: 3 });
  assert.equal(reopenedMilestone.revision, 4); assert.equal(reopenedMilestone.status, 'open'); assert.equal(reopenedMilestone.completedAtIso, undefined);
  await assert.rejects(() => repo.reopenProjectMilestone('r', 'm', { reopenedAtIso: T3, expectedRevision: 4 }), operation('PROJECTOPS_MILESTONE_NOT_COMPLETED'));

  const editedTask = await repo.editProjectTask('r', 't', { title: 'Rescheduled task', priority: 'high', dueAtIso: T3, expectedRevision: 1 }, T1);
  assert.equal(editedTask.revision, 2); assert.equal(editedTask.description, undefined); assert.equal(editedTask.assignee, undefined);
  const completedTask = await repo.completeProjectTask('r', 't', { completedBy: 'Operator', completedAtIso: T2, expectedRevision: 2 });
  assert.equal(completedTask.revision, 3); assert.equal(completedTask.completedBy, 'Operator');
  await assert.rejects(() => repo.completeProjectTask('r', 't', { completedBy: 'Operator', completedAtIso: T2, expectedRevision: 2 }), changed('PROJECTOPS_TASK_CHANGED'));
  const reopenedTask = await repo.reopenProjectTask('r', 't', { reopenedAtIso: T3, expectedRevision: 3 });
  assert.equal(reopenedTask.revision, 4); assert.equal(reopenedTask.completedAtIso, undefined); assert.equal(reopenedTask.completedBy, undefined);
  const clearedTask = await repo.editProjectTask('r', 't', { title: 'Cleared task', priority: 'medium', expectedRevision: 4 }, T3);
  assert.equal(clearedTask.revision, 5); assert.equal(clearedTask.dueAtIso, undefined);
});

test('Planning parent-state rules match the approved milestone and task matrices', () => {
  const base = createProjectRequest({ id: 'r', clientId: 'c', title: 'Planning', brief: 'Brief', createdAtIso: T0 });
  const request = (status: ProjectRequest['status']): ProjectRequest => ({ ...base, status });
  const milestoneInput = { id: 'm', projectRequestId: 'r', title: 'Milestone', createdAtIso: T0 };
  const taskInput = { id: 't', projectRequestId: 'r', title: 'Task', createdAtIso: T0 };
  for (const status of ['approved', 'in_progress'] as const) assert.doesNotThrow(() => createProjectMilestone(request(status), milestoneInput));
  for (const status of ['new', 'estimated', 'on_hold', 'delivered', 'cancelled', 'archived'] as const) assert.throws(() => createProjectMilestone(request(status), milestoneInput));
  for (const status of ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'] as const) assert.doesNotThrow(() => createProjectTask(request(status), taskInput));
  for (const status of ['new', 'cancelled', 'archived'] as const) assert.throws(() => createProjectTask(request(status), taskInput));
  for (const command of ['edit', 'complete', 'reopen'] as const) {
    for (const status of ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'] as const) assert.doesNotThrow(() => requireTaskParentState(request(status), command));
    for (const status of ['new', 'cancelled', 'archived'] as const) assert.throws(() => requireTaskParentState(request(status), command));
  }
  for (const command of ['edit', 'reopen'] as const) {
    for (const status of ['approved', 'in_progress'] as const) assert.doesNotThrow(() => requireMilestoneParentState(request(status), command));
    for (const status of ['new', 'estimated', 'on_hold', 'delivered', 'cancelled', 'archived'] as const) assert.throws(() => requireMilestoneParentState(request(status), command));
  }
  for (const status of ['approved', 'in_progress', 'on_hold', 'delivered'] as const) assert.doesNotThrow(() => requireMilestoneParentState(request(status), 'complete'));
  for (const status of ['new', 'estimated', 'cancelled', 'archived'] as const) assert.throws(() => requireMilestoneParentState(request(status), 'complete'));
});

test('Planning API validates edits and returns deterministic stale conflicts', async () => {
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0, clock: () => T0 });
  const send = (path: string, body: unknown, method = 'POST') => fetch(app.server.origin + '/projectops/' + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await send('clients', { id: 'c', name: 'Client' });
    await send('project-requests', { id: 'r', clientId: 'c', title: 'Planning', brief: 'Brief' });
    await send('project-requests/r/estimate', { amountCents: 100, currency: 'USD' });
    await send('project-requests/r/approve', { approvedBy: 'Operator' });
    assert.equal((await send('project-requests/r/tasks', { id: 't', title: 'Task' })).status, 200);
    assert.equal((await send('project-requests/r/tasks/t', { title: 'Missing priority', expectedRevision: 1 }, 'PUT')).status, 400);
    assert.equal((await send('project-requests/r/tasks/t', { title: 'Edited', priority: 'high', expectedRevision: 1 }, 'PUT')).status, 200);
    const stale = await send('project-requests/r/tasks/t/complete', { completedBy: 'Operator', expectedRevision: 1 });
    assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'PROJECTOPS_TASK_CHANGED');
    assert.equal((await send('project-requests/r/tasks/missing/reopen', { expectedRevision: 1 })).status, 404);
  } finally { await app.close(); }
});

function operation(code: string): (error: unknown) => boolean {
  return error => error instanceof ProjectOpsOperationError && error.code === code;
}
function changed(code: string): (error: unknown) => boolean {
  return error => operation(code)(error) && (error as ProjectOpsOperationError).kind === 'conflict';
}
