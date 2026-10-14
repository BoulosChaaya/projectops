import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsRepository, ProjectOpsMemorySqlExecutor, applyProjectOpsMigrations, composeProjectOpsDashboard, compareOperationalItems, validateDashboardFilter } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../apps/api/src/projectops/access.ts';
import { seedDashboard, assertDashboardContract, CREATED, NOW, FUTURE, BEFORE } from './dashboard-fixture.ts';

async function fixture() {
  const sql = new ProjectOpsMemorySqlExecutor(); await applyProjectOpsMigrations(sql);
  const repo = new ProjectOpsRepository(sql); await seedDashboard(repo); return { sql, repo };
}

test('Operational dashboard memory contract filters the entire read-only scope and preserves exact money/history', async () => {
  const { repo } = await fixture();
  const before = await Promise.all(['approved','delivered','cancelled','archived'].map(async id => [await repo.getProjectRequest(id), await repo.listProjectTasks(id), await repo.listProjectMilestones(id), await repo.listProjectActivities(id), await repo.listProjectInvoices(id)]));
  await assertDashboardContract(repo);
  const after = await Promise.all(['approved','delivered','cancelled','archived'].map(async id => [await repo.getProjectRequest(id), await repo.listProjectTasks(id), await repo.listProjectMilestones(id), await repo.listProjectActivities(id), await repo.listProjectInvoices(id)]));
  assert.deepEqual(after, before);
  const history = repo.withHistory({ actor: 'operator', clock: () => NOW });
  await history.createProjectNote('approved', { id: 'n', projectRequestId: 'approved', author: 'source', body: 'Note', createdAtIso: CREATED });
  assert.equal((await repo.getDashboard({}, NOW)).rows.find(r => r.id === 'approved')!.latestActivitySummary, 'Note added: n.');
  const count = (await repo.listProjectActivities('approved')).length;
  await history.getDashboard({}, NOW); assert.equal((await repo.listProjectActivities('approved')).length, count);
});

test('Operational classification uses strict instant boundaries, stable ties, no window and delivered deadline exclusion', async () => {
  const { repo } = await fixture();
  await repo.editProjectTask('approved','a-before',{title:'Equal',priority:'medium',dueAtIso:NOW,expectedRevision:1},NOW);
  await repo.editProjectTask('approved','z-before',{title:'Future',priority:'medium',dueAtIso:FUTURE,expectedRevision:1},NOW);
  await repo.completeProjectMilestone('approved','before',{expectedRevision:1,completedAtIso:NOW});
  assert.equal((await repo.getDashboard({ status:'approved' },NOW)).overdueWorkCount,0);
  await repo.reopenProjectMilestone('approved','before',{expectedRevision:2,reopenedAtIso:NOW});
  assert.equal((await repo.getDashboard({ status:'approved' },NOW)).overdueWorkCount,1);
  await repo.completeProjectTask('approved','z-before',{expectedRevision:2,completedAtIso:NOW,completedBy:'operator'});
  await repo.reopenProjectTask('approved','z-before',{expectedRevision:3,reopenedAtIso:NOW});
  assert.equal((await repo.getDashboard({ status:'approved' },NOW)).rows[0].nextUpcomingTask!.dueAtIso,FUTURE);
  const row = { id:'p',clientId:'c',clientName:'Client',title:'Title',priority:'low' as const,status:'approved' as const,updatedAtIso:NOW,deadlineIso:'2030-01-01T00:00:00Z' };
  const future = composeProjectOpsDashboard([row],{evaluationNow:NOW}); assert.equal(future.upcomingDeadlines[0].dueAtIso,'2030-01-01T00:00:00.000Z');
  for (const deadlineIso of [BEFORE,NOW,'2026-11-01T14:00:00+02:00']) assert.equal(composeProjectOpsDashboard([{...row,deadlineIso}],{evaluationNow:NOW}).upcomingDeadlines.length,0);
  assert.equal(composeProjectOpsDashboard([{...row,status:'delivered'}],{evaluationNow:NOW}).upcomingDeadlines.length,0);
  const a={id:'a',title:'A',dueAtIso:'2026-11-02T14:00:00+02:00',projectRequestId:'p',projectTitle:'P',kind:'task' as const,count:1};
  const b={...a,id:'b',dueAtIso:FUTURE}; assert.ok(compareOperationalItems(a,b)<0);
  assert.ok(compareOperationalItems({...a,dueAtIso:'2026-11-02T00:00:00+12:00'},{...b,dueAtIso:'2026-11-01T23:00:00-12:00'})<0);
  assert.deepEqual(validateDashboardFilter({q:'  TITLE ',status:'on_hold'}),{q:'title',status:'on_hold'});
});

test('Protected dashboard GET owns one clock, shares validation, timezone and no-store, and renders safe failures', async () => {
  const { sql,repo } = await fixture(); let samples=0,fail=false,reads=0;
  const session={login:'operator',csrfToken:'token',tokenHash:'hash',defaults:{defaultCurrency:'USD',defaultPriority:'low' as const,timezone:'Asia/Beirut'}};
  const app=await startProjectOpsApp({sql:{query:async statement=>{if(statement.sql.includes('dashboard_scope')){reads++;if(fail)throw Error('Private SQL detail');}return sql.query(statement);},transaction:run=>sql.transaction(run)},port:0,clock:()=>{samples++;return NOW;},access:new ProjectOpsAccess({resolve:async (token:string)=>token==='valid'?session:null} as any)});
  try {
    const headers={cookie:'projectops_session=valid'};
    assert.equal((await fetch(app.server.origin+'/projectops',{redirect:'manual'})).status,302);
    assert.equal((await fetch(app.server.origin+'/projectops/dashboard')).status,401);
    const before=await repo.listProjectActivities('approved'); const revision=(await repo.getProjectRequest('approved'))!.revision;
    const response=await fetch(app.server.origin+'/projectops/dashboard?q=project%20approved&status=approved&evaluationNow=2000-01-01T00:00:00Z',{headers});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store'); const data=await response.json();assert.equal(data.evaluationNow,NOW);assert.equal(samples,1);assert.equal(reads,1);
    const html=await fetch(app.server.origin+'/projectops?q=studio&status=on_hold',{headers}).then(r=>r.text());
    assert.match(html,/Asia\/Beirut/);assert.match(html,/On Hold/);assert.match(html,/1 matching projects/);assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>alert(1)'));
    for(const url of ['/projectops?status=archived','/projectops/dashboard?status=cancelled','/projectops/dashboard?q='+ 'a'.repeat(121)])assert.equal((await fetch(app.server.origin+url,{headers})).status,400);
    const empty=await fetch(app.server.origin+'/projectops?q=none',{headers}).then(r=>r.text());assert.match(empty,/No matching projects/);
    fail=true; const failure=await fetch(app.server.origin+'/projectops?q=studio&status=on_hold',{headers});assert.equal(failure.status,500);const unavailable=await failure.text();assert.match(unavailable,/Dashboard unavailable/);assert.match(unavailable,/q=studio&amp;status=on_hold/);assert.ok(!unavailable.includes('Private SQL'));assert.ok(!unavailable.includes('class="metric"'));
    assert.equal((await fetch(app.server.origin+'/projectops/dashboard',{headers})).status,500);fail=false;
    assert.deepEqual(await repo.listProjectActivities('approved'),before);assert.equal((await repo.getProjectRequest('approved'))!.revision,revision);
  } finally{await app.close();}
});

test('Empty scope, actual-instant resource/project order and completed future work remain distinct', async () => {
  const sql=new ProjectOpsMemorySqlExecutor();await applyProjectOpsMigrations(sql);const repo=new ProjectOpsRepository(sql);
  const empty=await repo.getDashboard({q:'missing'},NOW);assert.equal(empty.hasEligibleProjects,false);assert.equal(empty.totalActiveRequests,0);
  await repo.createClient({id:'c',name:'Client',createdAtIso:CREATED});
  for(const id of ['b','a'])await repo.createProjectRequest({id,clientId:'c',title:id,brief:'Brief',deadlineIso:'2030-01-01T00:00:00Z',createdAtIso:CREATED});
  assert.deepEqual((await repo.getDashboard({},NOW)).rows.map(r=>r.id),['a','b']);
  await repo.editProject('a',{title:'a',brief:'Brief',priority:'medium',expectedRevision:1},'2026-11-02T01:00:00+12:00');
  await repo.editProject('b',{title:'b',brief:'Brief',priority:'medium',expectedRevision:1},'2026-11-01T23:00:00-12:00');
  assert.deepEqual((await repo.getDashboard({},NOW)).rows.map(r=>r.id),['b','a']);
  await repo.estimateProjectRequest('a',{amountCents:100,currency:'USD',estimatedAtIso:CREATED});
  await repo.createProjectTask('a',{id:'a-later',projectRequestId:'a',title:'Later',dueAtIso:'2026-11-01T23:00:00-12:00',createdAtIso:CREATED});
  await repo.createProjectTask('a',{id:'z-earlier',projectRequestId:'a',title:'Earlier',dueAtIso:'2026-11-02T01:00:00+12:00',createdAtIso:CREATED});
  assert.equal((await repo.getDashboard({status:'estimated'},NOW)).upcomingDeadlines[0].id,'z-earlier');
  await repo.completeProjectTask('a','z-earlier',{expectedRevision:1,completedBy:'operator',completedAtIso:NOW});
  assert.equal((await repo.getDashboard({status:'estimated'},NOW)).upcomingDeadlines[0].id,'a-later');
  await repo.completeProjectTask('a','a-later',{expectedRevision:1,completedBy:'operator',completedAtIso:NOW});
  assert.equal((await repo.getDashboard({status:'estimated'},NOW)).upcomingDeadlines.length,0); // Edit cleared the project deadline.
});
