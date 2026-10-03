import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations,
  projectActivityEventTypes, updateProjectRequestStatusSql, ProjectOpsConnectionSqlExecutor,
  projectOpsPoolConnection, type ProjectOpsSqlExecutor,
} from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../apps/api/src/projectops/access.ts';
import { historyJourney, historyBusinessSnapshot, BUSINESS_TIME, ACTION_TIME, AUDIT_TIME } from './history-fixture.ts';

async function fixture() {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
  const base = new ProjectOpsRepository(sql);
  await base.createClient({ id: 'c', name: 'Client', createdAtIso: BUSINESS_TIME });
  return { sql, base, repo: base.withHistory({ actor: 'operator', clock: () => AUDIT_TIME }) };
}

test('Every approved history trigger commits exactly one trusted event; retries create none and business invariants remain intact', async () => {
  const { repo } = await fixture();
  const seen = await historyJourney(repo);
  assert.deepEqual([...seen].sort(), projectActivityEventTypes.filter(type => type !== 'operator_annotation').sort());
  const rows = await repo.listProjectActivities('r');
  assert.deepEqual(rows.map(row => row.id), rows.map(row => row.id).sort()); // timestamp ties use id ASC
  assert.ok(rows.every(row => !row.summary.includes('<img') && !row.summary.includes('Source author')));
});

test('Every covered command rolls back all business rows and revisions when required history insertion fails in memory', async () => {
  const { sql, base } = await fixture(); let fail = false, failures = 0;
  const decorate = (executor: ProjectOpsSqlExecutor): ProjectOpsSqlExecutor => ({
    async query<T>(statement) { if (fail && statement.sql.startsWith('INSERT INTO projectops_project_activities')) { failures++; throw new Error('Injected history failure'); } return await executor.query<T>(statement); },
    transaction: run => executor.transaction!(scoped => run(decorate(scoped))),
  });
  const repo = new ProjectOpsRepository(decorate(sql)).withHistory({ actor: 'operator', clock: () => AUDIT_TIME });
  await historyJourney(repo, 'operator', async (command, id) => {
    const before = await historyBusinessSnapshot(base, id); fail = true;
    try { await assert.rejects(command, /Injected history failure/); } finally { fail = false; }
    assert.deepEqual(await historyBusinessSnapshot(base, id), before);
  });
  assert.ok(failures >= 36);
});

test('History adds no false events on validation/missing/state failures and excludes foundational change requests', async () => {
  const { repo } = await fixture();
  for (const actor of ['', ' ', 'x'.repeat(121), undefined]) assert.throws(() => repo.withHistory({ actor, clock: () => AUDIT_TIME } as any), /authenticated operator identity/);
  await repo.createProjectRequest({ id: 'r', clientId: 'c', title: 'Project', brief: 'Brief', createdAtIso: BUSINESS_TIME });
  const before = await repo.listProjectActivities('r');
  for (const run of [
    () => repo.editProject('r', { title: '', brief: 'Brief', priority: 'medium', expectedRevision: 1 }, ACTION_TIME),
    () => repo.editProject('missing', { title: 'Title', brief: 'Brief', priority: 'medium', expectedRevision: 1 }, ACTION_TIME),
    () => repo.createProjectTask('r', { id: 't', projectRequestId: 'r', title: 'Task', createdAtIso: BUSINESS_TIME }),
    () => repo.createProjectInvoice('r', { id: 'i', projectRequestId: 'r', invoiceNumber: 'I', amountCents: 1, currency: 'EUR', issuedAtIso: BUSINESS_TIME }),
  ]) await assert.rejects(run);
  assert.deepEqual(await repo.listProjectActivities('r'), before);
  await repo.estimateProjectRequest('r', { amountCents: 1, currency: 'USD', estimatedAtIso: ACTION_TIME });
  await repo.approveProjectRequest('r', { approvedBy: 'source', approvedAtIso: ACTION_TIME });
  const initial = await repo.listProjectActivities('r');
  await repo.createProjectChangeRequest('r', { id: 'ch', projectRequestId: 'r', title: 'Change', description: 'Foundation', requestedBy: 'Source', requestedAtIso: BUSINESS_TIME });
  await repo.approveProjectChangeRequest('r', 'ch', { decidedBy: 'Source', decidedAtIso: ACTION_TIME });
  assert.deepEqual(await repo.listProjectActivities('r'), initial);
});

test('Annotations are guarded in all eight parent states with trusted identity/time and memory duplicate parity', async () => {
  for (const state of ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered', 'cancelled', 'archived'] as const) {
    const { sql, base, repo } = await fixture();
    await base.createProjectRequest({ id: 'r', clientId: 'c', title: 'Project', brief: 'Brief', createdAtIso: BUSINESS_TIME });
    await sql.query(updateProjectRequestStatusSql('r', state, ACTION_TIME, 1, 'new'));
    const input = { id: 'caller', projectRequestId: 'r', eventType: 'invoice_paid' as const, summary: 'Annotation', actor: 'Spoof', happenedAtIso: BUSINESS_TIME };
    if (['cancelled', 'archived'].includes(state)) { await assert.rejects(() => repo.createProjectActivity('r', input), (e: any) => e.kind === 'conflict'); assert.equal((await repo.listProjectActivities('r')).length, 0); }
    else { const row = await repo.createProjectActivity('r', input); assert.equal(row.eventType, 'operator_annotation'); assert.equal(row.actor, 'operator'); assert.equal(row.happenedAtIso, AUDIT_TIME); assert.notEqual(row.id, input.id); assert.equal((await repo.getProjectRequest('r'))!.revision, 2); }
  }
  const { base } = await fixture(); await base.createProjectRequest({ id: 'r', clientId: 'c', title: 'Project', brief: 'Brief', createdAtIso: BUSINESS_TIME });
  const fixed = base.withHistory({ actor: 'operator', clock: () => AUDIT_TIME, activityId: () => 'fixed' });
  const input = { id: 'ignored', projectRequestId: 'r', eventType: 'operator_annotation' as const, summary: 'Annotation', happenedAtIso: BUSINESS_TIME };
  await fixed.createProjectActivity('r', input); await assert.rejects(() => fixed.createProjectActivity('r', input), (e: any) => e.kind === 'conflict');
  await assert.rejects(() => fixed.createProjectActivity('missing', input), (e: any) => e.kind === 'not_found');
});

test('Transaction composition joins one PostgreSQL connection and propagates nested failure to outer rollback', async () => {
  const calls: string[] = []; let leases = 0;
  const connection = projectOpsPoolConnection({ async query() { assert.fail('Pool query escaped transaction'); }, async connect() { leases++; return { async query(sql: string) { calls.push(sql); return { rows: [], rowCount: 0, command: '' }; }, release() { calls.push('release'); } }; } });
  const executor = new ProjectOpsConnectionSqlExecutor(connection);
  await assert.rejects(() => executor.transaction(sql => sql.transaction!(async nested => { await nested.query({ sql: 'SELECT 1', params: [] }); throw new Error('nested failure'); })), /nested failure/);
  assert.equal(leases, 1); assert.deepEqual(calls, ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT 1', 'ROLLBACK', 'release']);
});

test('Concurrent independent memory commands retain both request-local actors without sharing business attribution', async () => {
  const { base } = await fixture();
  await base.createProjectRequest({ id: 'r', clientId: 'c', title: 'Project', brief: 'Brief', createdAtIso: BUSINESS_TIME });
  await base.estimateProjectRequest('r', { amountCents: 100, currency: 'USD', estimatedAtIso: ACTION_TIME });
  const actors = ['alice', 'bob'];
  await Promise.all(actors.map(actor => base.withHistory({ actor, clock: () => AUDIT_TIME }).createProjectTask('r', { id: actor, projectRequestId: 'r', title: actor, assignee: 'Other attribution', createdAtIso: BUSINESS_TIME })));
  const rows = await base.listProjectActivities('r'); assert.equal(rows.length, 2);
  for (const actor of actors) assert.equal(rows.find(r => r.summary === 'Task created: ' + actor + '.')!.actor, actor);
});

test('Protected API history owns identity/time, rejects forged annotations, preserves lifecycle route parity and emits no denied history', async () => {
  const session = { login: 'operator', csrfToken: 'csrf', tokenHash: 'hash', defaults: { defaultCurrency: 'USD', defaultPriority: 'medium', timezone: 'UTC' } };
  const access = new ProjectOpsAccess({ async resolve(token: string) { return token === 'valid' ? session : null; } } as any);
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), port: 0, clock: () => AUDIT_TIME, access });
  const headers = { cookie: 'projectops_session=valid', origin: app.server.origin, 'content-type': 'application/json', 'x-csrf-token': 'csrf' };
  const send = (path: string, body: unknown, extra = {}) => fetch(app.server.origin + '/projectops/' + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const ok = async (path: string, body: unknown) => { const r = await send(path, body); assert.equal(r.status, 200, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); return r.json(); };
  const read = (path: string) => fetch(app.server.origin + '/projectops/' + path, { headers }).then(r => r.json());
  try {
    await ok('clients', { id: 'c', name: 'Client' });
    await ok('project-requests', { id: 'r', clientId: 'c', title: 'Project', brief: 'Brief', actor: 'Spoof', happenedAtIso: BUSINESS_TIME });
    const root = 'project-requests/r'; const initial = await read(root + '/activities'); assert.equal(initial.length, 1); assert.equal(initial[0].actor, 'operator'); assert.equal(initial[0].happenedAtIso, AUDIT_TIME);
    for (const [extra, status] of [[{ cookie: '' }, 401], [{ origin: 'https://evil.test' }, 403], [{ 'content-type': 'text/plain' }, 415], [{ 'x-csrf-token': '' }, 403]] as const) assert.equal((await send(root + '/activities', { summary: 'Denied' }, extra)).status, status);
    for (const patch of [{ eventType: 'request_created' }, { actor: 'Spoof' }, { happenedAtIso: BUSINESS_TIME }, { createdAtIso: BUSINESS_TIME }, { id: 'caller' }]) assert.equal((await send(root + '/activities', { summary: 'Forged', ...patch })).status, 400);
    for (const summary of ['', ' ', 'x'.repeat(501)]) assert.equal((await send(root + '/activities', { summary })).status, 400);
    assert.deepEqual(await read(root + '/activities'), initial);
    assert.equal((await send('project-requests/missing/activities', { summary: 'Missing' })).status, 404);
    const annotation = await ok(root + '/activities', { summary: '<b>Operator context</b>' }); assert.equal(annotation.eventType, 'operator_annotation'); assert.equal(annotation.actor, 'operator'); assert.equal(annotation.createdAtIso, AUDIT_TIME);
    await ok(root + '/estimate', { amountCents: 100, expectedRevision: 1 });
    await ok(root + '/approve', { approvedBy: 'Business source', expectedRevision: 2 });
    const started = await ok(root + '/status', { status: 'in_progress', expectedRevision: 3 });
    await ok(root + '/control', { action: 'hold', expectedRevision: started.revision });
    const events = await read(root + '/activities'); assert.equal(events.filter((a: any) => a.eventType === 'status_changed').length, 2); assert.ok(events.every((a: any) => a.actor === 'operator'));
    assert.equal((await send(root + '/status', { status: 'in_progress', expectedRevision: 3 })).status, 409); assert.deepEqual(await read(root + '/activities'), events);
    await ok(root + '/control', { action: 'cancel', expectedRevision: 5 }); assert.equal((await send(root + '/activities', { summary: 'Terminal' })).status, 409);
    await ok(root + '/control', { action: 'archive', expectedRevision: 6 }); const retained = await read(root + '/activities'); assert.equal(retained.length, 8); assert.equal((await read(root)).revision, 7);
  } finally { await app.close(); }
});
