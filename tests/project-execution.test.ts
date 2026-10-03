import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectOpsMemorySqlExecutor,
  ProjectOpsOperationError,
  ProjectOpsRepository,
  applyProjectOpsMigrations,
  createProjectDocument,
  createProjectIssue,
  createProjectNote,
  createProjectRequest,
  createProjectRisk,
  createProjectWorkLog,
  requireExecutionActionParentState,
  type ProjectRequest,
} from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';

const T0 = '2026-10-03T12:00:00.000Z';
const T1 = '2026-10-03T13:00:00.000Z';

test('Execution parent-state rules match the approved resource matrix', () => {
  const base = createProjectRequest({ id: 'r', clientId: 'c', title: 'Execution', brief: 'Brief', createdAtIso: T0 });
  const request = (status: ProjectRequest['status']): ProjectRequest => ({ ...base, status });
  const inputs = {
    work_log: (parent: ProjectRequest) => createProjectWorkLog(parent, { id: 'w', projectRequestId: 'r', actor: 'operator', minutes: 30, loggedAtIso: T0 }),
    note: (parent: ProjectRequest) => createProjectNote(parent, { id: 'n', projectRequestId: 'r', author: 'operator', body: 'Note', createdAtIso: T0 }),
    document: (parent: ProjectRequest) => createProjectDocument(parent, { id: 'd', projectRequestId: 'r', title: 'Document', url: 'https://example.test/document', uploadedBy: 'operator', uploadedAtIso: T0 }),
    issue: (parent: ProjectRequest) => createProjectIssue(parent, { id: 'i', projectRequestId: 'r', title: 'Issue', description: 'Description', openedAtIso: T0 }),
    risk: (parent: ProjectRequest) => createProjectRisk(parent, { id: 'k', projectRequestId: 'r', title: 'Risk', description: 'Description', identifiedAtIso: T0 }),
  };
  const allowed = {
    work_log: ['estimated', 'approved', 'in_progress', 'delivered'],
    note: ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered'],
    document: ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'],
    issue: ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'],
    risk: ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'],
  } satisfies Record<keyof typeof inputs, ProjectRequest['status'][]>;
  const states: ProjectRequest['status'][] = ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered', 'cancelled', 'archived'];
  for (const [resource, create] of Object.entries(inputs) as [keyof typeof inputs, (parent: ProjectRequest) => unknown][]) {
    for (const status of states) {
      if (allowed[resource].includes(status)) assert.doesNotThrow(() => create(request(status)), `${resource}/${status}`);
      else assert.throws(() => create(request(status)), conflict(), `${resource}/${status}`);
    }
  }
  for (const status of states) {
    if (status === 'cancelled' || status === 'archived') assert.throws(() => requireExecutionActionParentState(request(status)), conflict());
    else assert.doesNotThrow(() => requireExecutionActionParentState(request(status)));
  }
});

test('Execution repository persists relationships, defaults and one-way terminal actions', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Execution', brief: 'Brief', createdAtIso: T0 });
  const note = await repo.createProjectNote('r', { id: 'n', projectRequestId: 'r', author: 'operator', body: 'New-state note', createdAtIso: T0 });
  assert.equal(note.visibility, 'internal');
  await repo.estimateProjectRequest('r', { amountCents: 100, currency: 'USD', estimatedAtIso: T0 });
  const task = await repo.createProjectTask('r', { id: 't', projectRequestId: 'r', title: 'Task', createdAtIso: T0 });
  const workLog = await repo.createProjectWorkLog('r', { id: 'w', projectRequestId: 'r', taskId: task.id, actor: 'operator', minutes: 30, loggedAtIso: T0 });
  const issue = await repo.createProjectIssue('r', { id: 'i', projectRequestId: 'r', title: 'Issue', description: 'Description', openedAtIso: T0 });
  const risk = await repo.createProjectRisk('r', { id: 'k', projectRequestId: 'r', title: 'Risk', description: 'Description', identifiedAtIso: T0 });
  const document = await repo.createProjectDocument('r', { id: 'd', projectRequestId: 'r', title: 'Document', url: 'https://example.test/document', uploadedBy: 'operator', uploadedAtIso: T0 });
  assert.equal(workLog.billable, true); assert.equal(workLog.taskId, 't');
  assert.equal(issue.severity, 'medium'); assert.equal(risk.probability, 'medium'); assert.equal(document.documentType, 'other');
  assert.equal((await repo.resolveProjectIssue('r', 'i', { resolvedAtIso: T1, resolutionNote: 'Fixed' })).status, 'resolved');
  assert.equal((await repo.mitigateProjectRisk('r', 'k', { mitigatedAtIso: T1, mitigationNote: 'Reduced' })).status, 'mitigated');
  assert.equal((await repo.archiveProjectDocument('r', 'd', { archivedAtIso: T1, archivedBy: 'operator' })).status, 'archived');
  assert.equal((await repo.archiveProjectNote('r', 'n', { archivedAtIso: T1, archivedBy: 'operator' })).status, 'archived');
  await assert.rejects(() => repo.resolveProjectIssue('r', 'i', { resolvedAtIso: T1 }), conflict('PROJECTOPS_ISSUE_ALREADY_RESOLVED'));
  await assert.rejects(() => repo.mitigateProjectRisk('r', 'missing', { mitigatedAtIso: T1 }), notFound('PROJECTOPS_RISK_NOT_FOUND'));
});

test('Execution API returns deterministic validation, missing and conflict responses', async () => {
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0, clock: () => T0 });
  const send = (path: string, body: unknown) => fetch(app.server.origin + '/projectops/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await send('clients', { id: 'c', name: 'Client' });
    await send('project-requests', { id: 'r', clientId: 'c', title: 'Execution', brief: 'Brief' });
    assert.equal((await send('project-requests/r/issues', { id: 'blocked', title: 'Blocked', description: 'Description' })).status, 409);
    assert.equal((await send('project-requests/r/notes', { id: 'invalid', body: '' , author: 'operator' })).status, 400);
    await send('project-requests/r/estimate', { amountCents: 100, currency: 'USD' });
    assert.equal((await send('project-requests/r/issues', { id: 'i', title: 'Issue', description: 'Description' })).status, 200);
    assert.equal((await send('project-requests/r/issues/missing/resolve', {})).status, 404);
    assert.equal((await send('project-requests/r/issues/i/resolve', {})).status, 200);
    assert.equal((await send('project-requests/r/issues/i/resolve', {})).status, 409);
  } finally { await app.close(); }
});

function conflict(code?: string): (error: unknown) => boolean {
  return error => error instanceof ProjectOpsOperationError && error.kind === 'conflict' && (!code || error.code === code);
}

function notFound(code: string): (error: unknown) => boolean {
  return error => error instanceof ProjectOpsOperationError && error.kind === 'not_found' && error.code === code;
}
