import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ProjectOpsRepository, ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection,
  projectActivityEventTypes,
} from '../../packages/projectops/src/index.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { operatorFixture } from './operator-fixture.ts';
import { historyJourney, historyBusinessSnapshot, BUSINESS_TIME, ACTION_TIME, AUDIT_TIME } from '../history-fixture.ts';

const conflict = (error: any) => error.kind === 'conflict';
async function migrate(pool: any, migrations?: any) {
  const client = await pool.connect();
  try { return await migrateProjectOpsPostgres(client, migrations ?? await loadProjectOpsPostgresMigrations()); }
  finally { client.release(); }
}
function repository(pool: any) { return new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool))); }
async function fixture(pool: any) {
  // Scope lock observation to this isolated fixture, even when the full suite runs concurrently.
  pool.options.application_name = 'history-' + randomUUID();
  await migrate(pool); const base = repository(pool);
  await base.createClient({ id: 'c', name: 'Client', createdAtIso: BUSINESS_TIME }); return base;
}
async function seed(base: ProjectOpsRepository, id: string, ready = false) {
  await base.createProjectRequest({ id, clientId: 'c', title: id, brief: 'Brief', createdAtIso: BUSINESS_TIME });
  await base.estimateProjectRequest(id, { amountCents: 100, currency: 'GBP', estimatedAtIso: ACTION_TIME });
  await base.approveProjectRequest(id, { approvedBy: 'Source', approvedAtIso: ACTION_TIME });
  await base.transitionProjectRequest(id, 'in_progress', ACTION_TIME, 3);
  if (ready) { await base.createProjectDeliverable(id, { id: 'ready', projectRequestId: id, title: 'Ready', artifactUrl: 'https://example.test/artifact', submittedAtIso: BUSINESS_TIME }); await base.acceptProjectDeliverable(id, 'ready', ACTION_TIME); }
}

test('Migration 0007 expands only event taxonomy on clean/upgrade schemas and preserves legacy rows exactly', async () => {
  await operatorFixture(async (_url, pool) => {
    const all = await loadProjectOpsPostgresMigrations();
    await migrate(pool, all.filter(m => m.version < '0007'));
    const base = repository(pool); await base.createClient({ id: 'c', name: 'Client', createdAtIso: BUSINESS_TIME });
    await base.createProjectRequest({ id: 'r', clientId: 'c', title: 'Legacy', brief: 'Brief', createdAtIso: BUSINESS_TIME });
    await base.createProjectActivity('r', { id: 'legacy', projectRequestId: 'r', eventType: 'note_added', summary: 'Legacy annotation', happenedAtIso: BUSINESS_TIME });
    const before = (await pool.query('SELECT * FROM projectops_project_activities')).rows;
    assert.deepEqual(await migrate(pool, all), ['0007']);
    assert.deepEqual((await pool.query('SELECT * FROM projectops_project_activities')).rows, before);
    for (const eventType of projectActivityEventTypes) await base.createProjectActivity('r', { id: eventType, projectRequestId: 'r', eventType, summary: 'Constraint probe', happenedAtIso: AUDIT_TIME });
    await assert.rejects(() => pool.query("INSERT INTO projectops_project_activities VALUES ('invalid','r','invalid','Invalid',NULL,$1,$1)", [AUDIT_TIME]), (error: any) => error.code === '23514');
    assert.equal((await base.getProjectActivity('r', 'legacy'))!.actor, null);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM projectops_schema_migrations')).rows[0].n, 7);
  });
});

test('Real PostgreSQL records every approved trigger, rejects retries, and rolls back every mutation when its history insert fails', async () => {
  await operatorFixture(async (_url, pool) => {
    const base = await fixture(pool), repo = base.withHistory({ actor: 'operator', clock: () => AUDIT_TIME });
    await pool.query("CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected history persistence failure'; END $$");
    let failures = 0;
    const seen = await historyJourney(repo, 'operator', async (command, id) => {
      const before = await historyBusinessSnapshot(base, id);
      await pool.query('CREATE TRIGGER reject_history BEFORE INSERT ON projectops_project_activities FOR EACH ROW EXECUTE FUNCTION reject_history()');
      try { await assert.rejects(command, /Injected history persistence failure/); failures++; }
      finally { await pool.query('DROP TRIGGER reject_history ON projectops_project_activities'); }
      assert.deepEqual(await historyBusinessSnapshot(base, id), before);
    });
    assert.ok(failures >= 36);
    assert.deepEqual([...seen].sort(), projectActivityEventTypes.filter(t => t !== 'operator_annotation').sort());
    assert.equal((await repo.getProjectRequest('r'))!.status, 'archived');
    const rows = await repo.listProjectActivities('r'); assert.deepEqual(rows.map(r => r.id), rows.map(r => r.id).sort());
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM projectops_project_activities a LEFT JOIN projectops_project_requests p ON p.id=a.project_request_id WHERE p.id IS NULL')).rows[0].n, 0);
    const active = await repo.createProjectRequest({ id: 'latest', clientId: 'c', title: 'Latest', brief: 'Brief', createdAtIso: BUSINESS_TIME });
    const dashboard = (await repo.getDashboard()).rows.find(r => r.id === active.id)!;
    assert.equal(dashboard.latestActivitySummary, 'Project created: latest.'); assert.equal(dashboard.latestActivityAtIso, AUDIT_TIME);
  });
});

test('Protected automatic history and annotations survive application restart and remain readable after cancellation/archive', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const config = { databaseUrl, host: '127.0.0.1', port: 0 };
    let app = await startProjectOpsPostgresApp(config);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'history-test-password');
      const login = await fetch(app.server.origin + '/projectops/access/login', { method: 'POST', headers: { origin: app.server.origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'history-test-password' }) });
      assert.equal(login.status, 200); const csrf = (await login.json()).csrfToken, cookie = login.headers.get('set-cookie')!.split(';')[0];
      const headers = () => ({ cookie, origin: app.server.origin, 'content-type': 'application/json', 'x-csrf-token': csrf });
      const send = async (path: string, data: unknown) => { const r = await fetch(app.server.origin + '/projectops/' + path, { method: 'POST', headers: headers(), body: JSON.stringify(data) }); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
      const read = (path: string) => fetch(app.server.origin + '/projectops/' + path, { headers: headers() }).then(r => r.json());
      const auditStart = Date.now();
      await send('clients', { id: 'c', name: 'Client' }); await send('project-requests', { id: 'r', clientId: 'c', title: 'Restart', brief: 'Brief' });
      await send('project-requests/r/notes', { id: 'n', author: 'Source author', body: 'Note' });
      const annotation = await send('project-requests/r/activities', { summary: 'Operator annotation' }); assert.equal(annotation.eventType, 'operator_annotation');
      const before = await read('project-requests/r/activities'); assert.equal(before.length, 3); assert.ok(before.every((r: any) => r.actor === 'operator' && Date.parse(r.happenedAtIso) >= auditStart && Date.parse(r.happenedAtIso) <= Date.now() && r.createdAtIso === r.happenedAtIso));
      await app.close(); app = await startProjectOpsPostgresApp(config); assert.deepEqual(await read('project-requests/r/activities'), before);
      await send('project-requests/r/control', { action: 'cancel', expectedRevision: 1 }); await send('project-requests/r/control', { action: 'archive', expectedRevision: 2 });
      await app.close(); app = await startProjectOpsPostgresApp(config); const after = await read('project-requests/r/activities'); assert.equal(after.length, 5); assert.equal((await read('project-requests/r')).revision, 3);
      const rejected = await fetch(app.server.origin + '/projectops/project-requests/r/activities', { method: 'POST', headers: headers(), body: JSON.stringify({ summary: 'Terminal' }) }); assert.equal(rejected.status, 409); assert.deepEqual(await read('project-requests/r/activities'), after);
    } finally { await app.close(); }
  });
});

function pairedRepository(pool: any, match: (text: string) => boolean) {
  const connection = projectOpsPoolConnection(pool); let reads = 0, release!: () => void;
  const barrier = new Promise<void>(resolve => release = resolve);
  const decorate = (scope: any): any => ({
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await scope.query<T>(text, params);
      if (reads < 2 && match(text)) { if (++reads === 2) release(); await barrier; }
      return result;
    },
    ...(scope.transaction ? { transaction: (run: any) => scope.transaction((nested: any) => run(decorate(nested))) } : {}),
  });
  return { base: new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(decorate(connection))), reads: () => reads };
}

test('Controlled project/planning/execution/delivery/feedback/finance races produce one business winner and exactly its request-local history', async () => {
  await operatorFixture(async (_url, pool) => {
    const base = await fixture(pool);
    const cases = [
      { id: 'project', table: 'requests', events: ['request_edited', 'request_edited'], setup: async () => {}, run: (r: any, id: string, n: number) => r.editProject(id, { title: 'Operator ' + n, brief: 'Brief', priority: 'medium', expectedRevision: 4 }, ACTION_TIME) },
      { id: 'milestone', table: 'milestones', events: ['milestone_edited', 'milestone_completed'], setup: (id: string) => base.createProjectMilestone(id, { id: 'm', projectRequestId: id, title: 'Milestone', createdAtIso: BUSINESS_TIME }), run: (r: any, id: string, n: number) => n ? r.completeProjectMilestone(id, 'm', { completedAtIso: ACTION_TIME, expectedRevision: 1 }) : r.editProjectMilestone(id, 'm', { title: 'Edit', expectedRevision: 1 }, ACTION_TIME) },
      { id: 'task', table: 'tasks', events: ['task_edited', 'task_completed'], setup: (id: string) => base.createProjectTask(id, { id: 't', projectRequestId: id, title: 'Task', createdAtIso: BUSINESS_TIME }), run: (r: any, id: string, n: number) => n ? r.completeProjectTask(id, 't', { completedBy: 'Source', completedAtIso: ACTION_TIME, expectedRevision: 1 }) : r.editProjectTask(id, 't', { title: 'Edit', priority: 'medium', expectedRevision: 1 }, ACTION_TIME) },
      { id: 'issue', table: 'issues', events: ['issue_resolved', 'issue_resolved'], setup: (id: string) => base.createProjectIssue(id, { id: 'i', projectRequestId: id, title: 'Issue', description: 'Description', openedAtIso: BUSINESS_TIME }), run: (r: any, id: string) => r.resolveProjectIssue(id, 'i', { resolvedAtIso: ACTION_TIME }) },
      { id: 'deliverable', table: 'deliverables', events: ['deliverable_accepted', 'deliverable_accepted'], setup: (id: string) => base.createProjectDeliverable(id, { id: 'd', projectRequestId: id, title: 'Artifact', artifactUrl: 'https://example.test/file', submittedAtIso: BUSINESS_TIME }), run: (r: any, id: string) => r.acceptProjectDeliverable(id, 'd', ACTION_TIME) },
      { id: 'feedback', table: 'feedback', events: ['feedback_addressed', 'feedback_addressed'], setup: (id: string) => base.createProjectFeedback(id, { id: 'f', projectRequestId: id, author: 'Client source', message: 'Feedback', receivedAtIso: BUSINESS_TIME }), run: (r: any, id: string) => r.addressProjectFeedback(id, 'f', { addressedBy: 'Source', addressedAtIso: ACTION_TIME }) },
      { id: 'expense', table: 'expenses', events: ['expense_approved', 'expense_rejected'], setup: (id: string) => base.createProjectExpense(id, { id: 'e', projectRequestId: id, description: 'Expense', amountCents: 100, currency: 'USD', incurredAtIso: BUSINESS_TIME }), run: (r: any, id: string, n: number) => n ? r.rejectProjectExpense(id, 'e', { decidedBy: 'Source', decidedAtIso: ACTION_TIME }) : r.approveProjectExpense(id, 'e', { decidedBy: 'Source', decidedAtIso: ACTION_TIME }) },
      { id: 'invoice', table: 'invoices', events: ['invoice_paid', 'invoice_paid'], setup: (id: string) => base.createProjectInvoice(id, { id: 'i', projectRequestId: id, invoiceNumber: 'I', amountCents: 100, currency: 'EUR', issuedAtIso: BUSINESS_TIME }), run: (r: any, id: string) => r.markProjectInvoicePaid(id, 'i', ACTION_TIME) },
    ];
    for (const c of cases) {
      await seed(base, c.id); await c.setup(c.id);
      const pair = pairedRepository(pool, text => c.table === 'requests' ? text.includes('FROM projectops_project_requests') && text.includes('WHERE id = $1') && !text.endsWith('FOR UPDATE') : text.includes('FROM projectops_project_' + c.table) && text.includes('AND id = $2'));
      const actors = ['alice', 'bob'];
      const results = await Promise.allSettled(actors.map((actor, n) => c.run(pair.base.withHistory({ actor, clock: () => AUDIT_TIME }), c.id, n)));
      assert.equal(pair.reads(), 2, c.id); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, c.id);
      const winner = results.findIndex(r => r.status === 'fulfilled');
      for (const result of results) if (result.status === 'rejected') assert.ok(conflict(result.reason), String(result.reason));
      const rows = await base.listProjectActivities(c.id); assert.equal(rows.length, 1, c.id); assert.equal(rows[0].actor, actors[winner]); assert.equal(rows[0].eventType, c.events[winner]);
      assert.equal((await base.getProjectRequest(c.id))!.revision, c.id === 'project' ? 5 : 4);
    }
  });
});

async function waitLocked(pool: any, prefix: string) {
  for (let i = 0; i < 250; i++) { if ((await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=current_setting('application_name') AND wait_event_type='Lock' AND query LIKE $1", [prefix + '%'])).rows.length) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Expected blocked query: ' + prefix);
}
function pauseBeforeHistory(pool: any, actor: string) {
  const connection = projectOpsPoolConnection(pool); let signal!: () => void, resume!: () => void;
  const reached = new Promise<void>(resolve => signal = resolve), proceed = new Promise<void>(resolve => resume = resolve);
  const paused = new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor({ ...connection,
    transaction: run => connection.transaction!(scoped => run({ async query<T>(text: string, params: readonly unknown[] = []) {
      if (text.startsWith('INSERT INTO projectops_project_activities')) { signal(); await proceed; }
      return await scoped.query<T>(text, params);
    } })),
  })).withHistory({ actor, clock: () => AUDIT_TIME });
  return { repo: paused, reached, resume };
}

test('Controlled lifecycle-first and child-first serialization retains locks through history and blocks post-terminal annotations', async () => {
  await operatorFixture(async (_url, pool) => {
    const base = await fixture(pool), other = base.withHistory({ actor: 'other', clock: () => AUDIT_TIME });
    for (const terminal of ['cancelled', 'archived'] as const) {
      const id = terminal; await seed(base, id); if (terminal === 'archived') await base.transitionProjectRequest(id, 'cancelled', ACTION_TIME, 4);
      const revision = (await base.getProjectRequest(id))!.revision, owner = pauseBeforeHistory(pool, 'lifecycle');
      const first = owner.repo.transitionProjectRequest(id, terminal, ACTION_TIME, revision); await owner.reached;
      const second = (terminal === 'cancelled' ? other.createProjectTask(id, { id: 'blocked', projectRequestId: id, title: 'Blocked', createdAtIso: BUSINESS_TIME }) : other.createProjectActivity(id, { id: 'ignored', projectRequestId: id, eventType: 'operator_annotation', summary: 'Blocked', happenedAtIso: BUSINESS_TIME })).then(value => ({ value }), error => ({ error }));
      await waitLocked(pool, terminal === 'cancelled' ? 'INSERT INTO projectops_project_tasks' : 'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE'); owner.resume(); await first;
      assert.ok(conflict((await second as any).error)); const rows = await base.listProjectActivities(id); assert.equal(rows.length, 1); assert.equal(rows[0].actor, 'lifecycle'); assert.equal(rows[0].eventType, 'status_changed'); assert.equal((await base.listProjectTasks(id)).length, 0);
    }
    await seed(base, 'child-first'); const child = pauseBeforeHistory(pool, 'child');
    const first = child.repo.createProjectNote('child-first', { id: 'n', projectRequestId: 'child-first', author: 'Source', body: 'Note', createdAtIso: BUSINESS_TIME }); await child.reached;
    const cancel = other.transitionProjectRequest('child-first', 'cancelled', ACTION_TIME, 4); await waitLocked(pool, 'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE'); child.resume(); await first; await cancel;
    const rows = await base.listProjectActivities('child-first'); assert.equal(rows.length, 2); assert.equal(rows.find(r => r.eventType === 'note_added')!.actor, 'child'); assert.equal(rows.find(r => r.eventType === 'status_changed')!.actor, 'other'); assert.equal((await base.listProjectNotes('child-first')).length, 1);
  });
});

test('Concurrent independent PostgreSQL actors and duplicate child/annotation races preserve exact committed history', async () => {
  await operatorFixture(async (_url, pool) => {
    const base = await fixture(pool); await seed(base, 'actors');
    await Promise.all(['alice', 'bob'].map(actor => base.withHistory({ actor, clock: () => AUDIT_TIME }).createProjectTask('actors', { id: actor, projectRequestId: 'actors', title: actor, assignee: 'Business attribution', createdAtIso: BUSINESS_TIME })));
    const actorRows = await base.listProjectActivities('actors'); assert.equal(actorRows.length, 2);
    for (const actor of ['alice', 'bob']) assert.equal(actorRows.find(r => r.summary === 'Task created: ' + actor + '.')!.actor, actor);
    for (const kind of ['task', 'invoice', 'expense', 'annotation']) {
      await seed(base, kind); const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query('SELECT id FROM projectops_project_requests WHERE id=$1 FOR UPDATE', [kind]);
        const pending = ['alice', 'bob'].map(actor => {
          const repo = base.withHistory({ actor, clock: () => AUDIT_TIME, ...(kind === 'annotation' ? { activityId: () => 'same-generated-id' } : {}) });
          const command = kind === 'task' ? repo.createProjectTask(kind, { id: 'same', projectRequestId: kind, title: 'Task', createdAtIso: BUSINESS_TIME }) : kind === 'invoice' ? repo.createProjectInvoice(kind, { id: actor, projectRequestId: kind, invoiceNumber: 'Same number', amountCents: 100, currency: 'EUR', issuedAtIso: BUSINESS_TIME }) : kind === 'expense' ? repo.createProjectExpense(kind, { id: 'same', projectRequestId: kind, description: 'Expense', amountCents: 100, currency: 'USD', incurredAtIso: BUSINESS_TIME }) : repo.createProjectActivity(kind, { id: 'ignored', projectRequestId: kind, eventType: 'operator_annotation', summary: actor, happenedAtIso: BUSINESS_TIME });
          return command.then(value => ({ value, actor }), error => ({ error, actor }));
        });
        let blocked = false;
        for (let n = 0; n < 250; n++) {
          const count = (await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name=current_setting('application_name') AND wait_event_type='Lock' AND (query LIKE 'INSERT INTO projectops_project_%' OR query LIKE 'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE%')")).rows[0].n;
          if (count >= 2) { blocked = true; break; } await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(blocked, kind); await client.query('COMMIT'); const results: any[] = await Promise.all(pending);
        assert.equal(results.filter(r => r.value).length, 1); assert.ok(conflict(results.find(r => r.error).error));
        const rows = await base.listProjectActivities(kind); assert.equal(rows.length, 1); assert.equal(rows[0].actor, results.find(r => r.value).actor);
        assert.equal((await base.getProjectRequest(kind))!.revision, 4);
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
  });
});

test('Controlled delivery/archival readiness races keep their predicate and record only winning commands', async () => {
  await operatorFixture(async (_url, pool) => {
    const base = await fixture(pool), other = base.withHistory({ actor: 'other', clock: () => AUDIT_TIME });
    for (const kind of ['submission', 'acceptance', 'feedback', 'addressing', 'post-delivery-feedback', 'archive-first', 'feedback-before-archive']) {
      const id = kind; await seed(base, id, kind !== 'acceptance');
      if (kind === 'acceptance') await base.createProjectDeliverable(id, { id: 'd', projectRequestId: id, title: 'Final', artifactUrl: 'https://example.test/final', submittedAtIso: BUSINESS_TIME });
      if (kind === 'addressing') await base.createProjectFeedback(id, { id: 'f', projectRequestId: id, author: 'Client', message: 'Final feedback', receivedAtIso: BUSINESS_TIME });
      if (['archive-first', 'feedback-before-archive'].includes(kind)) await base.transitionProjectRequest(id, 'delivered', ACTION_TIME, 4);
      const parentRevision = (await base.getProjectRequest(id))!.revision, owner = pauseBeforeHistory(pool, 'owner');
      const feedback = (r: ProjectOpsRepository) => r.createProjectFeedback(id, { id: 'f', projectRequestId: id, author: 'Client source', message: 'Feedback', receivedAtIso: BUSINESS_TIME });
      const first = kind === 'submission' ? owner.repo.createProjectDeliverable(id, { id: 'new', projectRequestId: id, title: 'New submission', artifactUrl: 'https://example.test/new', submittedAtIso: BUSINESS_TIME }) : kind === 'acceptance' ? owner.repo.acceptProjectDeliverable(id, 'd', ACTION_TIME) : kind === 'addressing' ? owner.repo.addressProjectFeedback(id, 'f', { addressedBy: 'Source', addressedAtIso: ACTION_TIME }) : ['feedback', 'feedback-before-archive'].includes(kind) ? feedback(owner.repo) : owner.repo.transitionProjectRequest(id, kind === 'archive-first' ? 'archived' : 'delivered', ACTION_TIME, parentRevision);
      await owner.reached;
      const second = (['archive-first', 'post-delivery-feedback'].includes(kind) ? feedback(other) : other.transitionProjectRequest(id, kind === 'feedback-before-archive' ? 'archived' : 'delivered', ACTION_TIME, parentRevision)).then(value => ({ value }), error => ({ error }));
      await waitLocked(pool, ['archive-first', 'post-delivery-feedback'].includes(kind) ? 'INSERT INTO projectops_project_feedback' : 'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE');
      owner.resume(); await first; const outcome: any = await second;
      const blocked = ['submission', 'feedback', 'archive-first', 'feedback-before-archive'].includes(kind);
      if (blocked) assert.ok(conflict(outcome.error), String(outcome.error)); else assert.ok(outcome.value);
      const rows = await base.listProjectActivities(id); assert.equal(rows.length, blocked ? 1 : 2, kind); assert.equal(rows.filter(r => r.actor === 'owner').length, 1);
      assert.equal(rows.filter(r => r.actor === 'other').length, blocked ? 0 : 1);
    }
    // A transaction holding the parent through history remains the sole project-revision winner.
    for (const firstStatus of ['cancelled', 'delivered'] as const) {
      const id = 'revision-' + firstStatus; await seed(base, id, true); const owner = pauseBeforeHistory(pool, 'winner');
      const first = owner.repo.transitionProjectRequest(id, firstStatus, ACTION_TIME, 4); await owner.reached;
      const second = other.transitionProjectRequest(id, firstStatus === 'cancelled' ? 'delivered' : 'cancelled', ACTION_TIME, 4).then(value => ({ value }), error => ({ error }));
      await waitLocked(pool, 'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE'); owner.resume(); await first; assert.ok(conflict((await second as any).error)); assert.equal((await base.listProjectActivities(id)).length, 1);
    }
  });
});
