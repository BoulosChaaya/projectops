import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import {
  ProjectOpsConnectionSqlExecutor,
  projectOpsPoolConnection,
  ProjectOpsOperationError,
  ProjectOpsRepository,
  insertProjectIssueSql,
} from '../../packages/projectops/src/index.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';

const T0 = '2026-10-03T12:00:00.000Z';
const T1 = '2026-10-03T13:00:00.000Z';
const T2 = '2026-10-03T14:00:00.000Z';

test('Execution resources persist across restart with state, relationship and error contracts', async () => {
  await operatorFixture(async (_databaseUrl, pool) => {
    await migrate(pool);
    let repo = repository(pool);
    await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
    await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Execution', brief: 'Brief', createdAtIso: T0 });
    await repo.createProjectNote('r', { id: 'new-note', projectRequestId: 'r', author: 'operator', body: 'Created while new', createdAtIso: T0 });
    await assert.rejects(() => repo.createProjectIssue('r', issueInput('blocked', 'r')), conflict('PROJECTOPS_REQUEST_NOT_READY_FOR_ISSUES'));
    await repo.estimateProjectRequest('r', { amountCents: 100, currency: 'USD', estimatedAtIso: T0 });
    await repo.approveProjectRequest('r', { approvedBy: 'operator', approvedAtIso: T0 });
    const task = await repo.createProjectTask('r', { id: 'task', projectRequestId: 'r', title: 'Task', createdAtIso: T0 });
    const milestone = await repo.createProjectMilestone('r', { id: 'milestone', projectRequestId: 'r', title: 'Milestone', createdAtIso: T0 });
    await repo.completeProjectMilestone('r', milestone.id, T0);
    const deliverable = await repo.createProjectDeliverable('r', { id: 'deliverable', projectRequestId: 'r', milestoneId: milestone.id, title: 'Deliverable', artifactUrl: 'https://example.test/deliverable', submittedAtIso: T0 });
    const workLog = await repo.createProjectWorkLog('r', { id: 'work', projectRequestId: 'r', taskId: task.id, actor: 'operator', minutes: 45, loggedAtIso: T0 });
    const issue = await repo.createProjectIssue('r', issueInput('issue', 'r'));
    const risk = await repo.createProjectRisk('r', riskInput('risk', 'r'));
    const document = await repo.createProjectDocument('r', { id: 'document', projectRequestId: 'r', deliverableId: deliverable.id, title: 'Document', url: 'https://example.test/document', uploadedBy: 'operator', uploadedAtIso: T0 });
    assert.equal(workLog.billable, true); assert.equal(issue.severity, 'medium'); assert.equal(risk.impact, 'medium'); assert.equal(document.documentType, 'other');
    await repo.resolveProjectIssue('r', issue.id, { resolvedAtIso: T1, resolutionNote: 'Fixed' });
    await repo.mitigateProjectRisk('r', risk.id, { mitigatedAtIso: T1, mitigationNote: 'Reduced' });
    await repo.archiveProjectDocument('r', document.id, { archivedAtIso: T1, archivedBy: 'operator' });
    await repo.archiveProjectNote('r', 'new-note', { archivedAtIso: T1, archivedBy: 'operator' });

    repo = repository(pool);
    assert.equal((await repo.listProjectWorkLogs('r'))[0]?.taskId, 'task');
    assert.equal((await repo.listProjectIssues('r'))[0]?.resolutionNote, 'Fixed');
    assert.equal((await repo.listProjectRisks('r'))[0]?.mitigationNote, 'Reduced');
    assert.equal((await repo.listProjectDocuments('r'))[0]?.deliverableId, 'deliverable');
    assert.equal((await repo.listProjectNotes('r'))[0]?.archivedBy, 'operator');
    await assert.rejects(() => repo.resolveProjectIssue('r', 'issue', { resolvedAtIso: T2 }), conflict('PROJECTOPS_ISSUE_ALREADY_RESOLVED'));
    await assert.rejects(() => repo.archiveProjectNote('r', 'missing', { archivedAtIso: T2, archivedBy: 'operator' }), notFound('PROJECTOPS_NOTE_NOT_FOUND'));
    await assert.rejects(() => repo.createProjectWorkLog('r', { id: 'missing-task', projectRequestId: 'r', taskId: 'missing', actor: 'operator', minutes: 5, loggedAtIso: T2 }), notFound('PROJECTOPS_TASK_NOT_FOUND'));
    await assert.rejects(() => repo.createProjectDocument('r', { id: 'missing-deliverable', projectRequestId: 'r', deliverableId: 'missing', title: 'Missing', url: 'https://example.test/missing', uploadedBy: 'operator', uploadedAtIso: T2 }), notFound('PROJECTOPS_DELIVERABLE_NOT_FOUND'));
    await assert.rejects(() => repo.createProjectIssue('r', issueInput('issue', 'r')), conflict('PROJECTOPS_ISSUE_ALREADY_EXISTS'));

    let project = await repo.getProjectRequest('r');
    project = await repo.transitionProjectRequest('r', 'in_progress', T1, project?.revision);
    project = await repo.transitionProjectRequest('r', 'on_hold', T1, project.revision);
    await assert.rejects(() => repo.createProjectWorkLog('r', { id: 'held-work', projectRequestId: 'r', actor: 'operator', minutes: 5, loggedAtIso: T2 }), conflict('PROJECTOPS_REQUEST_NOT_READY_FOR_WORK_LOGS'));
    await repo.createProjectNote('r', { id: 'held-note', projectRequestId: 'r', author: 'operator', body: 'Held note', createdAtIso: T2 });
    await repo.createProjectIssue('r', issueInput('held-issue', 'r'));
    await repo.createProjectRisk('r', riskInput('held-risk', 'r'));
    await repo.createProjectDocument('r', { id: 'held-document', projectRequestId: 'r', title: 'Held document', url: 'https://example.test/held', uploadedBy: 'operator', uploadedAtIso: T2 });
    project = await repo.transitionProjectRequest('r', 'cancelled', T2, project.revision);
    await assert.rejects(() => repo.createProjectNote('r', { id: 'cancelled-note', projectRequestId: 'r', author: 'operator', body: 'Blocked', createdAtIso: T2 }), conflict());
    assert.equal((await repo.listProjectNotes('r')).some(note => note.id === 'cancelled-note'), false);
  });
});

test('Execution SQL serializes terminal commands and parent lifecycle races', async () => {
  await operatorFixture(async (_databaseUrl, pool) => {
    await migrate(pool); const repo = repository(pool);
    await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });

    await approved(repo, 'terminal');
    await repo.createProjectIssue('terminal', issueInput('issue', 'terminal'));
    await repo.createProjectRisk('terminal', riskInput('risk', 'terminal'));
    await repo.createProjectNote('terminal', { id: 'note', projectRequestId: 'terminal', author: 'operator', body: 'Note', createdAtIso: T0 });
    await repo.createProjectDocument('terminal', { id: 'document', projectRequestId: 'terminal', title: 'Document', url: 'https://example.test/document', uploadedBy: 'operator', uploadedAtIso: T0 });
    await exactlyOne([
      () => repo.resolveProjectIssue('terminal', 'issue', { resolvedAtIso: T1, resolutionNote: 'one' }),
      () => repo.resolveProjectIssue('terminal', 'issue', { resolvedAtIso: T2, resolutionNote: 'two' }),
    ]);
    await exactlyOne([
      () => repo.mitigateProjectRisk('terminal', 'risk', { mitigatedAtIso: T1, mitigationNote: 'one' }),
      () => repo.mitigateProjectRisk('terminal', 'risk', { mitigatedAtIso: T2, mitigationNote: 'two' }),
    ]);
    await exactlyOne([
      () => repo.archiveProjectNote('terminal', 'note', { archivedAtIso: T1, archivedBy: 'one' }),
      () => repo.archiveProjectNote('terminal', 'note', { archivedAtIso: T2, archivedBy: 'two' }),
    ]);
    await exactlyOne([
      () => repo.archiveProjectDocument('terminal', 'document', { archivedAtIso: T1, archivedBy: 'one' }),
      () => repo.archiveProjectDocument('terminal', 'document', { archivedAtIso: T2, archivedBy: 'two' }),
    ]);

    const createRaces = [
      ['work', 'INSERT INTO projectops_project_work_logs', (id: string) => repo.createProjectWorkLog(id, { id: 'child', projectRequestId: id, actor: 'operator', minutes: 5, loggedAtIso: T1 })],
      ['note', 'INSERT INTO projectops_project_notes', (id: string) => repo.createProjectNote(id, { id: 'child', projectRequestId: id, author: 'operator', body: 'Note', createdAtIso: T1 })],
      ['document', 'INSERT INTO projectops_project_documents', (id: string) => repo.createProjectDocument(id, { id: 'child', projectRequestId: id, title: 'Document', url: 'https://example.test/document', uploadedBy: 'operator', uploadedAtIso: T1 })],
      ['issue', 'INSERT INTO projectops_project_issues', (id: string) => repo.createProjectIssue(id, issueInput('child', id))],
      ['risk', 'INSERT INTO projectops_project_risks', (id: string) => repo.createProjectRisk(id, riskInput('child', id))],
    ] as const;
    for (const [name, query, create] of createRaces) {
      const id = 'cancel-create-' + name; await approved(repo, id);
      await lifecycleWins(pool, id, "status='cancelled'", query, () => create(id));
      assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM projectops_project_${name === 'work' ? 'work_logs' : name + 's'} WHERE project_request_id=$1`, [id])).rows[0].count), 0);
    }

    const actionRaces = [
      ['issue', 'UPDATE projectops_project_issues AS child', async (id: string) => { await repo.createProjectIssue(id, issueInput('child', id)); return () => repo.resolveProjectIssue(id, 'child', { resolvedAtIso: T1 }); }, 'open'],
      ['risk', 'UPDATE projectops_project_risks AS child', async (id: string) => { await repo.createProjectRisk(id, riskInput('child', id)); return () => repo.mitigateProjectRisk(id, 'child', { mitigatedAtIso: T1 }); }, 'open'],
      ['document', 'UPDATE projectops_project_documents AS child', async (id: string) => { await repo.createProjectDocument(id, { id: 'child', projectRequestId: id, title: 'Document', url: 'https://example.test/document', uploadedBy: 'operator', uploadedAtIso: T0 }); return () => repo.archiveProjectDocument(id, 'child', { archivedAtIso: T1, archivedBy: 'operator' }); }, 'active'],
      ['note', 'UPDATE projectops_project_notes AS child', async (id: string) => { await repo.createProjectNote(id, { id: 'child', projectRequestId: id, author: 'operator', body: 'Note', createdAtIso: T0 }); return () => repo.archiveProjectNote(id, 'child', { archivedAtIso: T1, archivedBy: 'operator' }); }, 'active'],
    ] as const;
    for (const [name, query, setup, expectedStatus] of actionRaces) {
      const id = 'cancel-action-' + name; await approved(repo, id); const mutate = await setup(id);
      await lifecycleWins(pool, id, "status='cancelled'", query, mutate);
      assert.equal((await pool.query(`SELECT status FROM projectops_project_${name}s WHERE project_request_id=$1`, [id])).rows[0].status, expectedStatus);
    }

    await approved(repo, 'hold-work');
    await lifecycleWins(pool, 'hold-work', "status='on_hold'", 'INSERT INTO projectops_project_work_logs', () => repo.createProjectWorkLog('hold-work', { id: 'child', projectRequestId: 'hold-work', actor: 'operator', minutes: 5, loggedAtIso: T1 }));
    assert.equal((await repo.listProjectWorkLogs('hold-work')).length, 0);

    await approved(repo, 'child-first');
    const issue = await repo.createProjectIssue('child-first', issueInput('existing', 'child-first'));
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      const statement = insertProjectIssueSql({ ...issue, id: 'child-first-insert' });
      await blocker.query(statement.sql, [...statement.params]);
      const cancel = repo.transitionProjectRequest('child-first', 'cancelled', T2, 3);
      assert.ok(await waitForLock(pool, 'UPDATE projectops_project_requests'));
      await blocker.query('COMMIT');
      assert.equal((await cancel).status, 'cancelled');
      assert.ok(await repo.getProjectIssue('child-first', 'child-first-insert'));
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }

    await approved(repo, 'archive-win');
    let archived = await repo.getProjectRequest('archive-win');
    archived = await repo.transitionProjectRequest('archive-win', 'in_progress', T1, archived?.revision);
    await repo.createProjectDeliverable('archive-win', { id: 'delivery', projectRequestId: 'archive-win', title: 'Delivery', artifactUrl: 'https://example.test/artifact', submittedAtIso: T1 });
    await repo.acceptProjectDeliverable('archive-win', 'delivery', T1);
    archived = await repo.transitionProjectRequest('archive-win', 'delivered', T1, archived.revision);
    await lifecycleWins(pool, 'archive-win', "status='archived'", 'INSERT INTO projectops_project_notes', () => repo.createProjectNote('archive-win', { id: 'late', projectRequestId: 'archive-win', author: 'operator', body: 'Late', createdAtIso: T2 }));
    assert.equal((await repo.listProjectNotes('archive-win')).length, 0);
  });
});

function repository(pool: any): ProjectOpsRepository {
  return new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool)));
}

async function migrate(pool: any): Promise<void> {
  const client = await pool.connect(); try { await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations()); } finally { client.release(); }
}

async function approved(repo: ProjectOpsRepository, id: string): Promise<void> {
  await repo.createProjectRequest({ id, clientId: 'c', title: id, brief: 'Brief', createdAtIso: T0 });
  await repo.estimateProjectRequest(id, { amountCents: 100, currency: 'USD', estimatedAtIso: T0 });
  await repo.approveProjectRequest(id, { approvedBy: 'operator', approvedAtIso: T0 });
}

function issueInput(id: string, projectRequestId: string) { return { id, projectRequestId, title: 'Issue ' + id, description: 'Description', openedAtIso: T0 }; }
function riskInput(id: string, projectRequestId: string) { return { id, projectRequestId, title: 'Risk ' + id, description: 'Description', identifiedAtIso: T0 }; }

async function exactlyOne(actions: readonly (() => Promise<unknown>)[]): Promise<void> {
  const results = await Promise.allSettled(actions.map(action => action()));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.kind, 'conflict');
}

async function lifecycleWins(pool: any, projectId: string, setSql: string, waitingQuery: string, mutate: () => Promise<unknown>): Promise<void> {
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query(`UPDATE projectops_project_requests SET ${setSql}, revision=revision+1 WHERE id=$1`, [projectId]);
    const mutation = mutate().then(value => value, error => error);
    assert.ok(await waitForLock(pool, waitingQuery), `Expected ${waitingQuery} to wait for the parent lock`);
    await blocker.query('COMMIT');
    const result = await mutation;
    assert.ok(result instanceof ProjectOpsOperationError); assert.equal(result.kind, 'conflict');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
}

async function waitForLock(pool: any, queryPrefix: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1", [queryPrefix + '%']);
    if (result.rows.length) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

function conflict(code?: string): (error: unknown) => boolean {
  return error => error instanceof ProjectOpsOperationError && error.kind === 'conflict' && (!code || error.code === code);
}
function notFound(code: string): (error: unknown) => boolean {
  return error => error instanceof ProjectOpsOperationError && error.kind === 'not_found' && error.code === code;
}
