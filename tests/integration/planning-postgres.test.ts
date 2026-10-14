import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import {
  ProjectOpsConnectionSqlExecutor,
  ProjectOpsRepository,
  editProjectTaskSql,
} from '../../packages/projectops/src/index.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';

const T0 = '2026-10-03T12:00:00.000Z';
const T1 = '2026-10-04T12:00:00.000Z';
const T2 = '2026-10-05T12:00:00.000Z';
const T3 = '2026-10-06T12:00:00.000Z';

test('Planning migration upgrades existing children and API workflows persist across restart', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const migrations = await loadProjectOpsPostgresMigrations();
    const migrationClient = await pool.connect();
    try {
      await migrateProjectOpsPostgres(migrationClient, migrations.slice(0, 5));
      await migrationClient.query("INSERT INTO projectops_clients(id,name,status,created_at,revision) VALUES('legacy-c','Legacy','active',$1,1)", [T0]);
      await migrationClient.query("INSERT INTO projectops_project_requests(id,client_id,title,brief,priority,status,created_at,updated_at,revision) VALUES('legacy-r','legacy-c','Legacy','Brief','medium','approved',$1,$1,1)", [T0]);
      await migrationClient.query("INSERT INTO projectops_project_milestones(id,project_request_id,title,status,created_at,updated_at) VALUES('legacy-m','legacy-r','Legacy milestone','open',$1,$1)", [T0]);
      await migrationClient.query("INSERT INTO projectops_project_tasks(id,project_request_id,title,priority,status,created_at,updated_at) VALUES('legacy-t','legacy-r','Legacy task','medium','open',$1,$1)", [T0]);
      assert.deepEqual(await migrateProjectOpsPostgres(migrationClient, migrations), migrations.map(m => m.version).filter(v => v >= '0006'));
      assert.equal((await migrationClient.query("SELECT revision FROM projectops_project_milestones WHERE id='legacy-m'")).rows[0].revision, 1);
      assert.equal((await migrationClient.query("SELECT revision FROM projectops_project_tasks WHERE id='legacy-t'")).rows[0].revision, 1);
    } finally { migrationClient.release(); }

    // Pin "now" before the T2/T3 due dates so the due-date rule is evaluated against a fixed
    // creation time, not the wall clock (which passed T2 on 2026-10-05 and broke this test).
    const config = { databaseUrl, host: '127.0.0.1', port: 0, clock: () => T1 };
    let app = await startProjectOpsPostgresApp(config);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'planning-acceptance-password');
      let origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'planning-acceptance-password' }) });
      assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0]; const csrf = (await login.json()).csrfToken;
      const headers = () => ({ origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf });
      const send = (path: string, body: unknown, method = 'POST') => fetch(origin + '/projectops/' + path, { method, headers: headers(), body: JSON.stringify(body) });
      const read = (path: string) => fetch(origin + '/projectops/' + path, { headers: headers() });

      await send('clients', { id: 'c', name: 'Client' });
      await send('project-requests', { id: 'r', clientId: 'c', title: 'Planning', brief: 'Brief' });
      await send('project-requests/r/estimate', { amountCents: 10000, currency: 'USD' });
      await send('project-requests/r/approve', { approvedBy: 'Operator' });
      let milestone = await json(await send('project-requests/r/milestones', { id: 'm', title: 'Milestone', dueAtIso: T2 }));
      let task = await json(await send('project-requests/r/tasks', { id: 't', title: 'Task', description: 'Description', assignee: 'A', priority: 'low', dueAtIso: T2 }));
      assert.equal(milestone.revision, 1); assert.equal(task.revision, 1);

      milestone = await json(await send('project-requests/r/milestones/m', { title: 'Milestone rescheduled', dueAtIso: T3, expectedRevision: 1 }, 'PUT'));
      task = await json(await send('project-requests/r/tasks/t', { title: 'Task rescheduled', priority: 'high', dueAtIso: T3, expectedRevision: 1 }, 'PUT'));
      assert.equal(milestone.revision, 2); assert.equal(task.revision, 2);
      milestone = await json(await send('project-requests/r/milestones/m', { title: 'Milestone cleared', expectedRevision: 2 }, 'PUT'));
      task = await json(await send('project-requests/r/tasks/t', { title: 'Task cleared', priority: 'medium', expectedRevision: 2 }, 'PUT'));
      assert.equal(milestone.dueAtIso, undefined); assert.equal(task.dueAtIso, undefined); assert.equal(task.description, null); assert.equal(task.assignee, null);

      milestone = await json(await send('project-requests/r/milestones/m/complete', { expectedRevision: 3 }));
      task = await json(await send('project-requests/r/tasks/t/complete', { completedBy: 'operator', expectedRevision: 3 }));
      assert.equal(milestone.revision, 4); assert.equal(task.revision, 4);
      assert.equal((await send('project-requests/r/tasks/t/reopen', { expectedRevision: 3 })).status, 409);
      milestone = await json(await send('project-requests/r/milestones/m/reopen', { expectedRevision: 4 }));
      task = await json(await send('project-requests/r/tasks/t/reopen', { expectedRevision: 4 }));
      assert.equal(milestone.revision, 5); assert.equal(task.revision, 5); assert.equal(task.completedBy, undefined);

      let project = await json(await read('project-requests/r'));
      project = await json(await send('project-requests/r/control', { action: 'start', expectedRevision: project.revision }));
      project = await json(await send('project-requests/r/control', { action: 'hold', expectedRevision: project.revision }));
      assert.equal((await send('project-requests/r/milestones/m', { title: 'Blocked', expectedRevision: 5 }, 'PUT')).status, 400);
      assert.equal((await send('project-requests/r/milestones', { id: 'blocked', title: 'Blocked' })).status, 400);
      milestone = await json(await send('project-requests/r/milestones/m/complete', { expectedRevision: 5 }));
      task = await json(await send('project-requests/r/tasks/t', { title: 'Allowed on hold', priority: 'high', expectedRevision: 5 }, 'PUT'));
      assert.equal((await send('project-requests/r/tasks', { id: 'held-task', title: 'Held task' })).status, 200);
      project = await json(await send('project-requests/r/control', { action: 'resume', expectedRevision: project.revision }));
      assert.equal((await send('project-requests/r/deliverables', { id: 'delivery', title: 'Delivery', artifactUrl: 'https://example.test/artifact' })).status, 200);
      assert.equal((await send('project-requests/r/deliverables/delivery/accept', {})).status, 200);
      project = await json(await send('project-requests/r/control', { action: 'deliver', expectedRevision: project.revision }));
      assert.equal((await send('project-requests/r/milestones/m/reopen', { expectedRevision: milestone.revision })).status, 400);
      task = await json(await send('project-requests/r/tasks/t/complete', { completedBy: 'operator', expectedRevision: task.revision }));
      task = await json(await send('project-requests/r/tasks/t/reopen', { expectedRevision: task.revision }));
      assert.equal((await send('project-requests/r/tasks', { id: 'delivered-task', title: 'Delivered task' })).status, 200);

      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      const savedMilestone = (await json(await read('project-requests/r/milestones')))[0];
      const savedTask = (await json(await read('project-requests/r/tasks'))).find((value: { id: string }) => value.id === 't');
      assert.equal(savedMilestone.title, 'Milestone cleared'); assert.equal(savedMilestone.status, 'completed'); assert.equal(savedMilestone.revision, 6);
      assert.equal(savedTask.title, 'Allowed on hold'); assert.equal(savedTask.status, 'open'); assert.equal(savedTask.revision, 8);
      assert.equal((await pool.query('SELECT * FROM projectops_schema_migrations')).rows.length, migrations.length);
    } finally { await app.close(); }
  });
});

test('Planning SQL serializes child decisions and parent cancellation races', async () => {
  await operatorFixture(async (_databaseUrl, pool) => {
    const migrationClient = await pool.connect();
    try { await migrateProjectOpsPostgres(migrationClient, await loadProjectOpsPostgresMigrations()); }
    finally { migrationClient.release(); }
    const sql = new ProjectOpsConnectionSqlExecutor({ async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await pool.query(text, [...params]); return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command };
    } });
    const repo = new ProjectOpsRepository(sql);
    await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
    const approved = async (id: string) => {
      await repo.createProjectRequest({ id, clientId: 'c', title: id, brief: 'Brief', createdAtIso: T0 });
      await repo.estimateProjectRequest(id, { amountCents: 100, currency: 'USD', estimatedAtIso: T0 });
      await repo.approveProjectRequest(id, { approvedBy: 'Operator', approvedAtIso: T0 });
    };

    await approved('child-race');
    await repo.createProjectTask('child-race', { id: 'edit', projectRequestId: 'child-race', title: 'Edit', createdAtIso: T0 });
    let results = await Promise.allSettled([
      repo.editProjectTask('child-race', 'edit', { title: 'First', priority: 'low', expectedRevision: 1 }, T1),
      repo.editProjectTask('child-race', 'edit', { title: 'Second', priority: 'high', expectedRevision: 1 }, T1),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'PROJECTOPS_TASK_CHANGED');

    await repo.createProjectTask('child-race', { id: 'decision', projectRequestId: 'child-race', title: 'Decision', createdAtIso: T0 });
    results = await Promise.allSettled([
      repo.editProjectTask('child-race', 'decision', { title: 'Edited', priority: 'medium', expectedRevision: 1 }, T1),
      repo.completeProjectTask('child-race', 'decision', { completedBy: 'Operator', completedAtIso: T1, expectedRevision: 1 }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'PROJECTOPS_TASK_CHANGED');

    await approved('cancel-task');
    await repo.createProjectTask('cancel-task', { id: 't', projectRequestId: 'cancel-task', title: 'Task', createdAtIso: T0 });
    await assertCancellationWins(pool, "UPDATE projectops_project_requests SET status='cancelled', revision=revision+1 WHERE id='cancel-task'", 'UPDATE projectops_project_tasks AS task',
      () => repo.editProjectTask('cancel-task', 't', { title: 'Too late', priority: 'medium', expectedRevision: 1 }, T1), 'PROJECTOPS_TASK_CHANGED');
    assert.equal((await repo.getProjectTask('cancel-task', 't'))?.title, 'Task');

    await approved('cancel-milestone');
    await repo.createProjectMilestone('cancel-milestone', { id: 'm', projectRequestId: 'cancel-milestone', title: 'Milestone', createdAtIso: T0 });
    await assertCancellationWins(pool, "UPDATE projectops_project_requests SET status='cancelled', revision=revision+1 WHERE id='cancel-milestone'", 'UPDATE projectops_project_milestones AS milestone',
      () => repo.completeProjectMilestone('cancel-milestone', 'm', { completedAtIso: T1, expectedRevision: 1 }), 'PROJECTOPS_MILESTONE_CHANGED');
    assert.equal((await repo.getProjectMilestone('cancel-milestone', 'm'))?.status, 'open');

    await approved('child-first');
    const task = await repo.createProjectTask('child-first', { id: 't', projectRequestId: 'child-first', title: 'Task', createdAtIso: T0 });
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      const statement = editProjectTaskSql({ ...task, title: 'Child committed first', updatedAtIso: T1 }, 1);
      await blocker.query(statement.sql, [...statement.params]);
      const cancellation = repo.transitionProjectRequest('child-first', 'cancelled', T2, 3);
      assert.ok(await waitForLock(pool, 'UPDATE projectops_project_requests'));
      await blocker.query('COMMIT');
      assert.equal((await cancellation).status, 'cancelled');
      assert.equal((await repo.getProjectTask('child-first', 't'))?.title, 'Child committed first');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
});

async function assertCancellationWins(
  pool: { connect(): Promise<any>; query(sql: string, params?: unknown[]): Promise<any> },
  cancellationSql: string,
  waitingQuery: string,
  mutate: () => Promise<unknown>,
  code: string
): Promise<void> {
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query(cancellationSql);
    const mutation = mutate().then(value => value, error => error);
    assert.ok(await waitForLock(pool, waitingQuery), 'Child mutation must wait for the parent row lock');
    await blocker.query('COMMIT');
    assert.equal((await mutation).code, code);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
}

async function waitForLock(pool: { query(sql: string, params?: unknown[]): Promise<any> }, queryPrefix: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1", [queryPrefix + '%']);
    if (result.rows.length) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

async function json(response: Response): Promise<any> {
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
