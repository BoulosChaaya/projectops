import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations, createProjectRequest,
  createProjectDeliverable, createProjectFeedback, acceptProjectDeliverable, addressProjectFeedback,
  requireDeliveryParentState, updateProjectRequestStatusSql, projectOpsPoolConnection,
  type ProjectRequestStatus } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../apps/api/src/projectops/access.ts';

const T0 = '2026-10-03T12:00:00.000Z', T1 = '2026-10-03T13:00:00.000Z';
const states: ProjectRequestStatus[] = ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered', 'cancelled', 'archived'];
const allowed = { submit: ['approved', 'in_progress'], accept: ['approved', 'in_progress', 'on_hold', 'delivered'], feedback: ['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'] };
const delivery = (id = 'd', projectRequestId = 'r') => ({ id, projectRequestId, title: 'Artifact', artifactUrl: 'https://example.test/artifact', submittedAtIso: T0 });
const feedback = (id = 'f', projectRequestId = 'r') => ({ id, projectRequestId, author: 'Client source', message: 'Review', receivedAtIso: T0 });
const conflict = (error: any) => error.kind === 'conflict';
const missing = (error: any) => error.kind === 'not_found';

async function fixture() {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql); const repo = new ProjectOpsRepository(sql);
  await repo.createClient({ id: 'c', name: 'Client', createdAtIso: T0 });
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Delivery', brief: 'Brief', createdAtIso: T0 });
  await repo.estimateProjectRequest('r', { amountCents: 100, currency: 'USD', estimatedAtIso: T0 });
  await repo.approveProjectRequest('r', { approvedBy: 'operator', approvedAtIso: T0 });
  return { sql, repo };
}

test('Delivery domain validates fields, defaults, terminal commands and every approved parent state', () => {
  const base = createProjectRequest({ id: 'r', clientId: 'c', title: 'Delivery', brief: 'Brief', createdAtIso: T0 });
  for (const status of states) {
    const parent = { ...base, status };
    for (const command of ['submit', 'accept', 'feedback'] as const) {
      if (allowed[command].includes(status)) assert.doesNotThrow(() => requireDeliveryParentState(parent, command));
      else assert.throws(() => requireDeliveryParentState(parent, command), conflict);
    }
  }
  const parent = { ...base, status: 'approved' as const };
  const d = createProjectDeliverable(parent, delivery());
  assert.equal(d.milestoneId, undefined); assert.equal(d.status, 'submitted');
  for (const patch of [{ id: 'bad/id' }, { title: ' ' }, { title: 'x'.repeat(161) }, { artifactUrl: 'javascript:alert(1)' }, { artifactUrl: 'ftp://example.test/file' }, { artifactUrl: 'https://' }, { artifactUrl: 'https://example.test/' + 'x'.repeat(2048) }, { submittedAtIso: 'bad' }, { milestoneId: 'bad/id' }]) assert.throws(() => createProjectDeliverable(parent, { ...delivery(), ...patch }));
  const accepted = acceptProjectDeliverable(d, T1); assert.equal(accepted.acceptedAtIso, T1);
  assert.throws(() => acceptProjectDeliverable(accepted, T1), conflict);
  assert.throws(() => acceptProjectDeliverable(d, 'bad'));
  const f = createProjectFeedback(parent, feedback()); assert.equal(f.sentiment, 'neutral');
  for (const sentiment of ['positive', 'neutral', 'negative'] as const) assert.equal(createProjectFeedback(parent, { ...feedback(), sentiment }).sentiment, sentiment);
  for (const patch of [{ author: '' }, { author: 'x'.repeat(121) }, { message: ' ' }, { message: 'x'.repeat(2001) }, { receivedAtIso: 'bad' }, { sentiment: 'bad' }, { deliverableId: 'bad/id' }]) assert.throws(() => createProjectFeedback(parent, { ...feedback(), ...patch } as any));
  const addressed = addressProjectFeedback(f, { addressedAtIso: T1, addressedBy: 'operator', responseNote: '' });
  assert.equal(addressed.responseNote, undefined); assert.equal(addressed.addressedBy, 'operator');
  assert.throws(() => addressProjectFeedback(addressed, { addressedAtIso: T1, addressedBy: 'operator' }), conflict);
  for (const patch of [{ addressedBy: '' }, { responseNote: 'x'.repeat(501) }, { addressedAtIso: 'bad' }]) assert.throws(() => addressProjectFeedback(f, { addressedAtIso: T1, addressedBy: 'operator', ...patch }));
});

test('Memory delivery executor mirrors the complete state matrix and preserves children and project revisions on failures', async () => {
  for (const status of states) {
    const { sql, repo } = await fixture();
    await repo.createProjectDeliverable('r', delivery()); await repo.createProjectFeedback('r', feedback());
    const current = (await repo.getProjectRequest('r'))!;
    await sql.query(updateProjectRequestStatusSql('r', status, T1, current.revision!, current.status));
    const revision = (await repo.getProjectRequest('r'))!.revision;
    const commands = [
      ['submit', () => repo.createProjectDeliverable('r', delivery('new-d'))],
      ['accept', () => repo.acceptProjectDeliverable('r', 'd', T1)],
      ['feedback', () => repo.createProjectFeedback('r', feedback('new-f'))],
      ['feedback', () => repo.addressProjectFeedback('r', 'f', { addressedAtIso: T1, addressedBy: 'operator' })],
    ] as const;
    for (const [command, run] of commands) {
      if (allowed[command].includes(status)) await run(); else await assert.rejects(run, conflict);
    }
    assert.equal((await repo.getProjectRequest('r'))!.revision, revision);
    assert.equal((await repo.getProjectDeliverable('r', 'd'))!.status, allowed.accept.includes(status) ? 'accepted' : 'submitted');
    assert.equal((await repo.getProjectFeedback('r', 'f'))!.status, allowed.feedback.includes(status) ? 'addressed' : 'open');
    await assert.rejects(() => repo.acceptProjectDeliverable('r', 'missing', T1), missing);
    await assert.rejects(() => repo.addressProjectFeedback('r', 'missing', { addressedAtIso: T1, addressedBy: 'operator' }), missing);
  }
});

test('Delivery readiness gates delivery and delivered archival, while cancelled archival bypasses readiness', async () => {
  const { repo } = await fixture(); let project = await repo.transitionProjectRequest('r', 'in_progress', T0);
  const blocked = () => repo.transitionProjectRequest('r', 'delivered', T1, project.revision);
  await assert.rejects(blocked, conflict);
  await repo.createProjectDeliverable('r', delivery()); await assert.rejects(blocked, conflict);
  await repo.acceptProjectDeliverable('r', 'd', T1);
  await repo.createProjectFeedback('r', feedback()); await assert.rejects(blocked, conflict);
  // Unfinished planning and execution records do not enter the delivery predicate.
  await repo.createProjectTask('r', { id: 't', projectRequestId: 'r', title: 'Open task', createdAtIso: T0 });
  await repo.createProjectMilestone('r', { id: 'm', projectRequestId: 'r', title: 'Open milestone', createdAtIso: T0 });
  await repo.createProjectIssue('r', { id: 'i', projectRequestId: 'r', title: 'Open issue', description: 'Description', openedAtIso: T0 });
  await repo.addressProjectFeedback('r', 'f', { addressedAtIso: T1, addressedBy: 'operator' });
  project = await blocked(); assert.equal(project.status, 'delivered'); assert.equal(project.revision, 5);
  await repo.createProjectFeedback('r', feedback('post-delivery'));
  await assert.rejects(() => repo.transitionProjectRequest('r', 'archived', T1, project.revision), conflict);
  assert.equal((await repo.getProjectRequest('r'))!.revision, project.revision);
  await repo.addressProjectFeedback('r', 'post-delivery', { addressedAtIso: T1, addressedBy: 'operator' });
  const archived = await repo.transitionProjectRequest('r', 'archived', T1, project.revision); assert.equal(archived.revision, 6);
  await assert.rejects(() => repo.transitionProjectRequest('r', 'archived', T1, project.revision), conflict);
  const other = await fixture(); const cancelled = await other.repo.transitionProjectRequest('r', 'cancelled', T1);
  assert.equal((await other.repo.transitionProjectRequest('r', 'archived', T1, cancelled.revision)).status, 'archived');
});

test('Memory concurrent delivery identities and terminal actions produce one success and one conflict', async () => {
  const { repo } = await fixture();
  const oneWinner = async (commands: Promise<unknown>[]) => {
    const results = await Promise.allSettled(commands);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(conflict((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason));
  };
  await oneWinner([repo.createProjectDeliverable('r', delivery()), repo.createProjectDeliverable('r', delivery())]);
  await oneWinner([repo.createProjectFeedback('r', feedback()), repo.createProjectFeedback('r', feedback())]);
  await oneWinner([repo.acceptProjectDeliverable('r', 'd', T1), repo.acceptProjectDeliverable('r', 'd', T1)]);
  await oneWinner([repo.addressProjectFeedback('r', 'f', { addressedAtIso: T1, addressedBy: 'operator' }), repo.addressProjectFeedback('r', 'f', { addressedAtIso: T1, addressedBy: 'operator' })]);
  assert.equal((await repo.getProjectRequest('r'))!.revision, 3);
});

test('Protected delivery API preserves source attribution, owns action identity/time, maps errors, and prevents status bypass', async () => {
  const session = { login: 'operator', csrfToken: 'csrf', tokenHash: 'hash', defaults: { defaultCurrency: 'USD', defaultPriority: 'medium', timezone: 'UTC' } };
  const access = new ProjectOpsAccess({ async resolve(token: string) { return token === 'valid' ? session : null; } } as any);
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0, clock: () => T1, access });
  const headers = { cookie: 'projectops_session=valid', origin: app.server.origin, 'content-type': 'application/json', 'x-csrf-token': 'csrf' };
  const send = (path: string, body: unknown, extra = {}) => fetch(app.server.origin + '/projectops/' + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const ok = async (path: string, body: unknown) => { const r = await send(path, body); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
  try {
    await ok('clients', { id: 'c', name: 'Client' }); await ok('project-requests', { id: 'r', clientId: 'c', title: 'Delivery', brief: 'Brief' });
    for (const path of ['deliverables', 'deliverables/d/accept', 'feedback', 'feedback/f/address']) {
      assert.equal((await send('project-requests/r/' + path, {}, { cookie: '' })).status, 401);
      assert.equal((await send('project-requests/r/' + path, {}, { origin: 'https://evil.test' })).status, 403);
      assert.equal((await send('project-requests/r/' + path, {}, { 'x-csrf-token': '' })).status, 403);
      assert.equal((await send('project-requests/r/' + path, {}, { 'content-type': 'text/plain' })).status, 415);
    }
    assert.equal((await send('project-requests/r/deliverables', delivery())).status, 409);
    await ok('project-requests/r/estimate', { amountCents: 100 }); await ok('project-requests/r/approve', { approvedBy: 'operator' });
    assert.equal((await send('project-requests/r/deliverables', { ...delivery(), milestoneId: 'missing' })).status, 404);
    assert.equal((await send('project-requests/r/feedback', { ...feedback(), deliverableId: 'missing' })).status, 404);
    assert.equal((await send('project-requests/r/deliverables', { ...delivery(), artifactUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await send('project-requests/r/feedback', { ...feedback(), sentiment: 'bad' })).status, 400);
    assert.equal((await send('project-requests/r/deliverables/bad%2Fid/accept', {})).status, 400);
    const d = await ok('project-requests/r/deliverables', delivery()); assert.equal(d.submittedAtIso, T1);
    assert.equal((await send('project-requests/r/deliverables', delivery())).status, 409);
    await ok('project-requests/r/control', { action: 'start', expectedRevision: 3 });
    assert.equal((await send('project-requests/r/status', { status: 'delivered' })).status, 409);
    const accepted = await ok('project-requests/r/deliverables/d/accept', { acceptedAtIso: T0 }); assert.equal(accepted.acceptedAtIso, T1);
    assert.equal((await send('project-requests/r/deliverables/d/accept', {})).status, 409);
    const f = await ok('project-requests/r/feedback', feedback()); assert.equal(f.author, 'Client source'); assert.equal(f.receivedAtIso, T1);
    assert.equal((await send('project-requests/r/control', { action: 'deliver', expectedRevision: 4 })).status, 409);
    const addressed = await ok('project-requests/r/feedback/f/address', { addressedBy: 'imposter', addressedAtIso: T0 }); assert.equal(addressed.addressedBy, 'operator'); assert.equal(addressed.addressedAtIso, T1);
    assert.equal((await send('project-requests/r/feedback/f/address', {})).status, 409);
    await ok('project-requests/r/status', { status: 'delivered', expectedRevision: 4 });
    await ok('project-requests/r/feedback', feedback('post'));
    for (const path of ['status', 'control']) assert.equal((await send('project-requests/r/' + path, path === 'status' ? { status: 'archived', expectedRevision: 5 } : { action: 'archive', expectedRevision: 5 })).status, 409);
    await ok('project-requests/r/feedback/post/address', {}); await ok('project-requests/r/control', { action: 'archive', expectedRevision: 5 });
    assert.equal((await send('project-requests/r/feedback/missing/address', {})).status, 404);
    assert.equal((await send('project-requests/missing/deliverables', delivery())).status, 404);
    const read = await fetch(app.server.origin + '/projectops/project-requests/r/deliverables', { headers }); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal((await read.json()).length, 1);
  } finally { await app.close(); }
});

test('Transaction connection leases one client and commits or rolls back before releasing it', async () => {
  const calls: string[] = [];
  const pool = { async query() { throw Error('pool.query must not run inside transaction'); }, async connect() { return { async query(sql: string) { calls.push(sql); return { rows: [], rowCount: 0 }; }, release() { calls.push('release'); } }; } };
  const connection = projectOpsPoolConnection(pool as any);
  await connection.transaction!(async scoped => { await scoped.query('SELECT 1'); });
  assert.deepEqual(calls, ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT 1', 'COMMIT', 'release']); calls.length = 0;
  await assert.rejects(() => connection.transaction!(async scoped => { await scoped.query('SELECT 2'); throw Error('failure'); }), /failure/);
  assert.deepEqual(calls, ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT 2', 'ROLLBACK', 'release']);
});
