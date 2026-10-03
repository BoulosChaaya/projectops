import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { ProjectOpsConnectionSqlExecutor, ProjectOpsRepository, projectOpsPoolConnection,
  insertProjectDeliverableSql, insertProjectFeedbackSql, acceptProjectDeliverableSql, addressProjectFeedbackSql,
  acceptProjectDeliverable, addressProjectFeedback, createProjectDeliverable, createProjectFeedback } from '../../packages/projectops/src/index.ts';

const T0 = '2026-10-03T12:00:00.000Z', T1 = '2026-10-03T13:00:00.000Z';
const delivery = (parent: string, id = 'd') => ({ id, projectRequestId: parent, title: 'Artifact', artifactUrl: 'https://example.test/artifact', submittedAtIso: T0 });
const feedback = (parent: string, id = 'f') => ({ id, projectRequestId: parent, author: 'Client source', message: 'Review', receivedAtIso: T0 });
const conflict = (error: any) => error.kind === 'conflict';
const missing = (error: any) => error.kind === 'not_found';
const repository = (pool: any) => new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool)));
async function migrate(pool: any) { const client = await pool.connect(); try { await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations()); } finally { client.release(); } }
async function seed(repo: ProjectOpsRepository, id: string, ready = false) {
  await repo.createProjectRequest({ id, clientId: 'c', title: id, brief: 'Brief', createdAtIso: T0 });
  await repo.estimateProjectRequest(id, { amountCents: 100, currency: 'USD', estimatedAtIso: T0 });
  await repo.approveProjectRequest(id, { approvedBy: 'operator', approvedAtIso: T0 });
  await repo.transitionProjectRequest(id, 'in_progress', T0);
  if (ready) { await repo.createProjectDeliverable(id, delivery(id)); await repo.acceptProjectDeliverable(id, 'd', T1); }
}

test('PostgreSQL delivery and feedback persist through restart with protected metadata and readiness controls', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const config = { databaseUrl, host: '127.0.0.1', port: 0 }; let app = await startProjectOpsPostgresApp(config);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'delivery-postgres-password');
      let origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'delivery-postgres-password' }) });
      const cookie = login.headers.get('set-cookie')!.split(';')[0], csrf = (await login.json()).csrfToken;
      const headers = () => ({ origin, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf });
      const send = (path: string, body: unknown) => fetch(origin + '/projectops/' + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const ok = async (path: string, body: unknown) => { const response = await send(path, body); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
      const read = (path: string) => fetch(origin + '/projectops/' + path, { headers: headers() }).then(r => r.json());
      await ok('clients', { id: 'c', name: 'Client' }); await ok('project-requests', { id: 'r', clientId: 'c', title: 'Delivery', brief: 'Brief' });
      await ok('project-requests/r/estimate', { amountCents: 100 }); await ok('project-requests/r/approve', { approvedBy: 'operator' });
      await ok('project-requests/r/milestones', { id: 'm', title: 'Open milestone is a valid relationship' });
      const first = await ok('project-requests/r/deliverables', delivery('r'));
      const second = await ok('project-requests/r/deliverables', { ...delivery('r', 'linked'), milestoneId: 'm' });
      assert.equal(first.milestoneId, undefined); assert.equal(second.milestoneId, 'm'); assert.notEqual(first.submittedAtIso, T0);
      assert.equal((await send('project-requests/r/deliverables', delivery('r'))).status, 409);
      assert.equal((await send('project-requests/r/deliverables', { ...delivery('r', 'bad'), milestoneId: 'missing' })).status, 404);
      const one = await ok('project-requests/r/feedback', feedback('r'));
      const two = await ok('project-requests/r/feedback', { ...feedback('r', 'linked'), deliverableId: 'linked', sentiment: 'negative' });
      assert.equal(one.sentiment, 'neutral'); assert.equal(two.deliverableId, 'linked'); assert.equal(two.author, 'Client source');
      assert.equal((await send('project-requests/r/feedback', feedback('r'))).status, 409);
      let project = await ok('project-requests/r/control', { action: 'start', expectedRevision: 3 });
      assert.equal((await send('project-requests/r/control', { action: 'deliver', expectedRevision: project.revision })).status, 409);
      for (const id of ['d', 'linked']) {
        await ok('project-requests/r/deliverables/' + id + '/accept', { acceptedAtIso: T0 });
        await ok('project-requests/r/feedback/' + (id === 'd' ? 'f' : id) + '/address', { addressedBy: 'imposter', addressedAtIso: T0, responseNote: id === 'd' ? 'Handled' : undefined });
      }
      assert.equal((await read('project-requests/r')).revision, 4);
      project = await ok('project-requests/r/status', { status: 'delivered', expectedRevision: 4 }); assert.equal(project.revision, 5);
      await app.close(); app = await startProjectOpsPostgresApp(config); origin = app.server.origin;
      const deliveries = await read('project-requests/r/deliverables'), reviews = await read('project-requests/r/feedback');
      assert.equal(deliveries.length, 2); assert.ok(deliveries.every((d: any) => d.status === 'accepted' && d.acceptedAtIso && !d.acceptedBy));
      assert.ok(reviews.every((f: any) => f.status === 'addressed' && f.addressedBy === 'operator' && f.addressedAtIso !== T0));
      assert.equal(reviews.find((f: any) => f.id === 'f').responseNote, 'Handled');
      assert.equal((await read('project-requests/r')).status, 'delivered');
      await ok('project-requests/r/feedback', feedback('r', 'after'));
      for (const path of ['status', 'control']) assert.equal((await send('project-requests/r/' + path, path === 'status' ? { status: 'archived', expectedRevision: 5 } : { action: 'archive', expectedRevision: 5 })).status, 409);
      await ok('project-requests/r/feedback/after/address', {}); await ok('project-requests/r/control', { action: 'archive', expectedRevision: 5 });
      assert.equal((await read('project-requests/r')).revision, 6); assert.equal((await read('project-requests/r/feedback')).length, 3);
      assert.equal((await send('project-requests/r/deliverables/missing/accept', {})).status, 404);
      await ok('project-requests', { id: 'cancelled', clientId: 'c', title: 'Cancelled', brief: 'Brief' });
      await ok('project-requests/cancelled/control', { action: 'cancel', expectedRevision: 1 }); await ok('project-requests/cancelled/control', { action: 'archive', expectedRevision: 2 });
    } finally { await app.close(); }
  });
});

test('PostgreSQL delivery commands enforce every parent state, relationships, constraints and unchanged failure rows', async () => {
  await operatorFixture(async (_url, pool) => {
    await migrate(pool); const repo = repository(pool); await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
    const allowed = { submit: ['approved', 'in_progress'], accept: ['approved', 'in_progress', 'on_hold', 'delivered'], feedback: ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'] };
    for (const state of ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered', 'cancelled', 'archived']) {
      await seed(repo, state); await repo.createProjectDeliverable(state, delivery(state)); await repo.createProjectFeedback(state, feedback(state));
      await pool.query('UPDATE projectops_project_requests SET status=$2 WHERE id=$1', [state, state]);
      const commands = [
        ['submit', () => repo.createProjectDeliverable(state, delivery(state, 'second'))],
        ['accept', () => repo.acceptProjectDeliverable(state, 'd', T1)],
        ['feedback', () => repo.createProjectFeedback(state, feedback(state, 'second'))],
        ['feedback', () => repo.addressProjectFeedback(state, 'f', { addressedAtIso: T1, addressedBy: 'operator' })],
      ] as const;
      for (const [command, run] of commands) { if (allowed[command].includes(state)) await run(); else await assert.rejects(run, conflict); }
      assert.equal((await repo.getProjectRequest(state))!.revision, 4);
      assert.equal((await repo.getProjectDeliverable(state, 'd'))!.status, allowed.accept.includes(state) ? 'accepted' : 'submitted');
      assert.equal((await repo.getProjectFeedback(state, 'f'))!.status, allowed.feedback.includes(state) ? 'addressed' : 'open');
      await assert.rejects(() => repo.acceptProjectDeliverable(state, 'missing', T1), missing);
      await assert.rejects(() => repo.addressProjectFeedback(state, 'missing', { addressedAtIso: T1, addressedBy: 'operator' }), missing);
    }
    await seed(repo, 'failure'); await seed(repo, 'other');
    await repo.createProjectMilestone('other', { id: 'm', projectRequestId: 'other', title: 'Milestone', createdAtIso: T0 });
    await repo.createProjectDeliverable('other', delivery('other'));
    await assert.rejects(() => repo.createProjectDeliverable('failure', { ...delivery('failure'), milestoneId: 'm' }), missing);
    await assert.rejects(() => repo.createProjectFeedback('failure', { ...feedback('failure'), deliverableId: 'd' }), missing);
    await assert.rejects(() => repo.createProjectDeliverable('missing', delivery('missing')), missing);
    await assert.rejects(() => repo.createProjectFeedback('missing', feedback('missing')), missing);
    await assert.rejects(() => repo.createProjectDeliverable('failure', { ...delivery('failure'), artifactUrl: 'javascript:alert(1)' }));
    assert.equal((await repo.listProjectDeliverables('failure')).length, 0); assert.equal((await repo.listProjectFeedback('failure')).length, 0);
    // Execute directly to prove useful SQL constraint mapping rather than only the repository preflight.
    const sql = new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool));
    const parent = (await repo.getProjectRequest('failure'))!;
    const d = createProjectDeliverable(parent, delivery('failure'));
    await sql.query(insertProjectDeliverableSql(d));
    await assert.rejects(() => sql.query(insertProjectDeliverableSql(d)), (error: any) => error.code === 'PROJECTOPS_DELIVERABLE_ALREADY_EXISTS');
    await assert.rejects(() => sql.query(insertProjectDeliverableSql({ ...d, id: 'missing-relation', milestoneId: 'missing' })), missing);
    const f = createProjectFeedback(parent, feedback('failure')); await sql.query(insertProjectFeedbackSql(f));
    await assert.rejects(() => sql.query(insertProjectFeedbackSql(f)), (error: any) => error.code === 'PROJECTOPS_FEEDBACK_ALREADY_EXISTS');
    await assert.rejects(() => sql.query(insertProjectFeedbackSql({ ...f, id: 'missing-relation', deliverableId: 'missing' })), missing);
    await repo.acceptProjectDeliverable('failure', 'd', T1); await repo.addressProjectFeedback('failure', 'f', { addressedAtIso: T1, addressedBy: 'operator' });
    await assert.rejects(() => repo.acceptProjectDeliverable('failure', 'd', T1), conflict);
    await assert.rejects(() => repo.addressProjectFeedback('failure', 'f', { addressedAtIso: T1, addressedBy: 'operator' }), conflict);
    assert.equal((await repo.getProjectRequest('failure'))!.revision, 4);
  });
});

async function waitLocked(pool: any, prefix: string) {
  for (let i = 0; i < 250; i++) {
    const r = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1", [prefix + '%']);
    if (r.rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Expected blocked query: ' + prefix);
}

async function parentWins(pool: any, id: string, state: string, prefix: string, action: () => Promise<unknown>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A cancelled project may archive without delivery readiness. Keep the winning lifecycle path valid.
    if (state === 'archived') await client.query("UPDATE projectops_project_requests SET status='cancelled', revision=revision+1 WHERE id=$1", [id]);
    await client.query('UPDATE projectops_project_requests SET status=$2, revision=revision+1 WHERE id=$1', [id, state]);
    const result = action().then(value => ({ value }), error => ({ error }));
    await waitLocked(pool, prefix); await client.query('COMMIT');
    assert.ok(conflict((await result as any).error));
  } finally { await client.query('ROLLBACK'); client.release(); }
}

async function childFirst(pool: any, statement: any, transition: () => Promise<unknown>, succeeds: boolean) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(statement.sql, statement.params);
    const result = transition().then(value => ({ value }), error => ({ error }));
    await waitLocked(pool, 'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE');
    await client.query('COMMIT'); const outcome: any = await result;
    if (succeeds) assert.ok(outcome.value); else assert.ok(conflict(outcome.error));
  } finally { await client.query('ROLLBACK'); client.release(); }
}

function pausedTransaction(pool: any) {
  const connection = projectOpsPoolConnection(pool); let resume!: () => void, signal!: () => void;
  const locked = new Promise<void>(resolve => signal = resolve), proceed = new Promise<void>(resolve => resume = resolve);
  const sql = new ProjectOpsConnectionSqlExecutor({ ...connection, transaction: run => connection.transaction!(scoped => run({
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await scoped.query<T>(text, params);
      if (text.endsWith('FOR UPDATE')) { signal(); await proceed; }
      return result;
    },
  })) });
  return { repo: new ProjectOpsRepository(sql), locked, resume: () => resume() };
}

test('Controlled PostgreSQL delivery concurrency serializes terminal actions and parent cancellation, hold and archive', async () => {
  await operatorFixture(async (_url, pool) => {
    await migrate(pool); const repo = repository(pool); await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
    for (const kind of ['deliverables', 'feedback']) {
      await seed(repo, kind); await repo.createProjectDeliverable(kind, delivery(kind)); await repo.createProjectFeedback(kind, feedback(kind));
      let reads = 0, release!: () => void; const barrier = new Promise<void>(resolve => release = resolve), connection = projectOpsPoolConnection(pool);
      const racing = new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor({ ...connection, async query<T>(text: string, params: readonly unknown[] = []) {
        const result = await connection.query<T>(text, params);
        if (reads < 2 && text.includes('FROM projectops_project_' + kind) && text.includes('AND id = $2')) { if (++reads === 2) release(); await barrier; }
        return result;
      } }));
      const command = () => kind === 'deliverables' ? racing.acceptProjectDeliverable(kind, 'd', T1) : racing.addressProjectFeedback(kind, 'f', { addressedAtIso: T1, addressedBy: 'operator' });
      const results = await Promise.allSettled([command(), command()]); assert.equal(reads, 2);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.ok(conflict((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason));
      assert.equal((await repo.getProjectRequest(kind))!.revision, 4);
    }
    for (const state of ['cancelled', 'archived']) for (const kind of ['deliverable', 'feedback']) for (const action of ['create', 'terminal']) {
      const id = `${state}-${kind}-${action}`; await seed(repo, id);
      if (action === 'terminal') { if (kind === 'deliverable') await repo.createProjectDeliverable(id, delivery(id)); else await repo.createProjectFeedback(id, feedback(id)); }
      const table = kind === 'deliverable' ? 'deliverables' : 'feedback';
      const mutate = kind === 'deliverable' ? action === 'create' ? () => repo.createProjectDeliverable(id, delivery(id)) : () => repo.acceptProjectDeliverable(id, 'd', T1) : action === 'create' ? () => repo.createProjectFeedback(id, feedback(id)) : () => repo.addressProjectFeedback(id, 'f', { addressedAtIso: T1, addressedBy: 'operator' });
      await parentWins(pool, id, state, (action === 'create' ? 'INSERT INTO ' : 'UPDATE ') + 'projectops_project_' + table, mutate);
      const rows = table === 'deliverables' ? await repo.listProjectDeliverables(id) : await repo.listProjectFeedback(id);
      assert.equal(rows.length, action === 'create' ? 0 : 1); if (rows.length) assert.equal(rows[0].status, kind === 'deliverable' ? 'submitted' : 'open');
    }
    await seed(repo, 'hold'); await parentWins(pool, 'hold', 'on_hold', 'INSERT INTO projectops_project_deliverables', () => repo.createProjectDeliverable('hold', delivery('hold')));
    assert.equal((await repo.listProjectDeliverables('hold')).length, 0);
    await seed(repo, 'cancel-delivery', true); const p = (await repo.getProjectRequest('cancel-delivery'))!;
    const paused = pausedTransaction(pool); const deliver = paused.repo.transitionProjectRequest(p.id, 'delivered', T1, p.revision); await paused.locked;
    const cancel = repo.transitionProjectRequest(p.id, 'cancelled', T1, p.revision).then(value => ({ value }), error => ({ error }));
    await waitLocked(pool, 'UPDATE projectops_project_requests'); paused.resume(); assert.equal((await deliver).status, 'delivered'); assert.ok(conflict((await cancel as any).error));
  });
});

test('Delivery and delivered archival evaluate a fresh child snapshot after the parent lock in both serialization orders', async () => {
  await operatorFixture(async (_url, pool) => {
    await migrate(pool); const repo = repository(pool); await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
    await seed(repo, 'submit-first', true);
    let parent = (await repo.getProjectRequest('submit-first'))!;
    await childFirst(pool, insertProjectDeliverableSql(createProjectDeliverable(parent, delivery(parent.id, 'new'))), () => repo.transitionProjectRequest(parent.id, 'delivered', T1, parent.revision), false);
    assert.equal((await repo.getProjectRequest(parent.id))!.status, 'in_progress'); assert.equal((await repo.listProjectDeliverables(parent.id)).length, 2);
    await seed(repo, 'accept-first'); await repo.createProjectDeliverable('accept-first', delivery('accept-first'));
    parent = (await repo.getProjectRequest('accept-first'))!;
    await childFirst(pool, acceptProjectDeliverableSql(acceptProjectDeliverable((await repo.getProjectDeliverable(parent.id, 'd'))!, T1)), () => repo.transitionProjectRequest(parent.id, 'delivered', T1, parent.revision), true);
    assert.equal((await repo.getProjectRequest(parent.id))!.status, 'delivered');
    await seed(repo, 'feedback-first', true); parent = (await repo.getProjectRequest('feedback-first'))!;
    await childFirst(pool, insertProjectFeedbackSql(createProjectFeedback(parent, feedback(parent.id))), () => repo.transitionProjectRequest(parent.id, 'delivered', T1, parent.revision), false);
    assert.equal((await repo.getProjectRequest(parent.id))!.status, 'in_progress');
    await seed(repo, 'address-first', true); await repo.createProjectFeedback('address-first', feedback('address-first')); parent = (await repo.getProjectRequest('address-first'))!;
    await childFirst(pool, addressProjectFeedbackSql(addressProjectFeedback((await repo.getProjectFeedback(parent.id, 'f'))!, { addressedAtIso: T1, addressedBy: 'operator' })), () => repo.transitionProjectRequest(parent.id, 'delivered', T1, parent.revision), true);
    assert.equal((await repo.getProjectRequest(parent.id))!.status, 'delivered');
    for (const kind of ['submit', 'feedback']) {
      const id = 'delivery-first-' + kind; await seed(repo, id, true); parent = (await repo.getProjectRequest(id))!;
      const paused = pausedTransaction(pool); const transition = paused.repo.transitionProjectRequest(id, 'delivered', T1, parent.revision); await paused.locked;
      const command = (kind === 'submit' ? repo.createProjectDeliverable(id, delivery(id, 'new')) : repo.createProjectFeedback(id, feedback(id))).then(value => ({ value }), error => ({ error }));
      await waitLocked(pool, 'INSERT INTO projectops_project_' + (kind === 'submit' ? 'deliverables' : 'feedback'));
      paused.resume(); assert.equal((await transition).status, 'delivered'); const outcome: any = await command;
      if (kind === 'submit') { assert.ok(conflict(outcome.error)); assert.equal((await repo.listProjectDeliverables(id)).length, 1); }
      else { assert.ok(outcome.value); assert.equal((await repo.listProjectFeedback(id))[0].status, 'open'); }
    }
    await seed(repo, 'archive-feedback-first', true); parent = await repo.transitionProjectRequest('archive-feedback-first', 'delivered', T1);
    await childFirst(pool, insertProjectFeedbackSql(createProjectFeedback(parent, feedback(parent.id))), () => repo.transitionProjectRequest(parent.id, 'archived', T1, parent.revision), false);
    assert.equal((await repo.getProjectRequest(parent.id))!.status, 'delivered');
    await seed(repo, 'archive-first', true); parent = await repo.transitionProjectRequest('archive-first', 'delivered', T1);
    const paused = pausedTransaction(pool); const archive = paused.repo.transitionProjectRequest(parent.id, 'archived', T1, parent.revision); await paused.locked;
    const child = repo.createProjectFeedback(parent.id, feedback(parent.id)).then(value => ({ value }), error => ({ error }));
    await waitLocked(pool, 'INSERT INTO projectops_project_feedback'); paused.resume(); assert.equal((await archive).status, 'archived'); assert.ok(conflict((await child as any).error));
    assert.equal((await repo.listProjectFeedback(parent.id)).length, 0);
  });
});
