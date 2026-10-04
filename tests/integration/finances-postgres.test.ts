import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations,migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { ProjectOpsConnectionSqlExecutor,ProjectOpsRepository,projectOpsPoolConnection,createProjectInvoice,createProjectExpense,
 insertProjectInvoiceSql,insertProjectExpenseSql,markProjectInvoicePaidSql,updateProjectExpenseDecisionSql,
 markProjectInvoicePaid,approveProjectExpense,selectDashboardRowsSql } from '../../packages/projectops/src/index.ts';
const T0='2026-10-03T12:00:00.000Z',T1='2026-10-03T13:00:00.000Z';
const invoice=(parent:string,id='i')=>({id,projectRequestId:parent,invoiceNumber:id,amountCents:100,currency:' eur ',issuedAtIso:T0});
const expense=(parent:string,id='e')=>({id,projectRequestId:parent,description:'Cost',amountCents:200,currency:' usd ',incurredAtIso:T0});
const decision={decidedAtIso:T1,decidedBy:'operator',decisionNote:'Handled'};
const conflict=(error:any)=>error.kind==='conflict',missing=(error:any)=>error.kind==='not_found';
const repository=(pool:any)=>new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool)));
async function migrate(pool:any){const client=await pool.connect();try{await migrateProjectOpsPostgres(client,await loadProjectOpsPostgresMigrations());}finally{client.release();}}
async function fixture(pool:any){await migrate(pool);const repo=repository(pool);await repo.createClient({id:'c',name:'Client',createdAtIso:T0});return repo;}
async function seed(repo:ProjectOpsRepository,id:string,ready=false){await repo.createProjectRequest({id,clientId:'c',title:id,brief:'Brief',createdAtIso:T0});await repo.estimateProjectRequest(id,{amountCents:100,currency:'GBP',estimatedAtIso:T0});await repo.approveProjectRequest(id,{approvedBy:'operator',approvedAtIso:T0});await repo.transitionProjectRequest(id,'in_progress',T0);if(ready){await repo.createProjectDeliverable(id,{id:'d',projectRequestId:id,title:'Artifact',artifactUrl:'https://example.test/artifact',submittedAtIso:T0});await repo.acceptProjectDeliverable(id,'d',T1);}}

test('PostgreSQL finance API persists relationships, business dates and protected audit metadata across restart',async()=>{
 await operatorFixture(async(databaseUrl,pool)=>{
  const config={databaseUrl,host:'127.0.0.1',port:0};let app=await startProjectOpsPostgresApp(config);
  try{
   await new ProjectOpsOperatorStore(pool).provision('operator','finance-postgres-password');let origin=app.server.origin;
   const login=await fetch(origin+'/projectops/access/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({login:'operator',password:'finance-postgres-password'})});const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json()).csrfToken;
   const headers=()=>({origin,cookie,'content-type':'application/json','x-csrf-token':csrf});
   const send=(path:string,body:unknown)=>fetch(origin+'/projectops/'+path,{method:'POST',headers:headers(),body:JSON.stringify(body)});
   const ok=async(path:string,body:unknown)=>{const r=await send(path,body);assert.equal(r.status,200,await r.clone().text());return r.json();};
   const read=(path:string)=>fetch(origin+'/projectops/'+path,{headers:headers()}).then(r=>r.json());
   await ok('clients',{id:'c',name:'Client'});await ok('project-requests',{id:'r',clientId:'c',title:'Finance',brief:'Brief'});const root='project-requests/r';await ok(root+'/estimate',{amountCents:100,currency:'GBP'});await ok(root+'/approve',{approvedBy:'operator'});
   await ok(root+'/milestones',{id:'m',title:'Milestone'});await ok(root+'/deliverables',{id:'d',milestoneId:'m',title:'Artifact',artifactUrl:'https://example.test/artifact'});await ok(root+'/deliverables/d/accept',{});
   const i=await ok(root+'/invoices',{...invoice('r'),issuedAtIso:'invalid',dueAtIso:'2099-01-01T00:00:00.000Z'});assert.equal(i.currency,'EUR');assert.notEqual(i.issuedAtIso,T0);assert.equal(i.deliverableId,undefined);
   const linked=await ok(root+'/invoices',{...invoice('r','linked'),deliverableId:'d'});assert.equal(linked.deliverableId,'d');
   const paid=await ok(root+'/invoices/i/pay',{paidAtIso:'invalid'});assert.ok(paid.paidAtIso);assert.notEqual(paid.paidAtIso,T0);
   const e=await ok(root+'/expenses',expense('r'));assert.equal(e.incurredAtIso,T0);assert.equal(e.category,'other');assert.equal(e.reimbursable,true);
   const defaulted=await ok(root+'/expenses',{...expense('r','reject'),incurredAtIso:undefined,category:'travel',vendor:'Vendor',reimbursable:false,receiptUrl:'https://example.test/receipt'});assert.notEqual(defaulted.incurredAtIso,T0);
   for(const [id,action]of [['e','approve'],['reject','reject']]){const done=await ok(root+'/expenses/'+id+'/'+action,{decidedAtIso:'invalid',decidedBy:'imposter',decisionNote:id==='e'?'Approved cost':undefined});assert.equal(done.decidedBy,'operator');assert.notEqual(done.decidedAtIso,T0);assert.ok(done.decidedAtIso);assert.equal((await send(root+'/expenses/'+id+'/'+action,{})).status,409);}
   assert.equal((await send(root+'/invoices/i/pay',{})).status,409);assert.equal((await read(root)).revision,3);
   await app.close();app=await startProjectOpsPostgresApp(config);origin=app.server.origin;
   const invoices=await read(root+'/invoices'),expenses=await read(root+'/expenses');assert.equal(invoices.length,2);assert.equal(invoices.find((r:any)=>r.id==='i').paidAtIso,paid.paidAtIso);assert.equal(expenses.length,2);assert.equal(expenses.find((r:any)=>r.id==='e').decisionNote,'Approved cost');assert.equal(expenses.find((r:any)=>r.id==='reject').receiptUrl,'https://example.test/receipt');
   await ok(root+'/expenses',expense('r','submitted'));await ok(root+'/control',{action:'start',expectedRevision:3});await ok(root+'/status',{status:'delivered',expectedRevision:4});await ok(root+'/control',{action:'archive',expectedRevision:5});
   assert.equal((await read(root+'/invoices')).length,2);assert.equal((await read(root+'/expenses')).length,3);assert.equal((await send(root+'/invoices/missing/pay',{})).status,404);assert.equal((await send(root+'/expenses/missing/reject',{})).status,404);
   assert.equal((await read('dashboard')).financeTotalsByCurrency.EUR,undefined);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM projectops_schema_migrations')).rows[0].n,7);
  }finally{await app.close();}
 });
});

test('PostgreSQL finance commands enforce all parent states, missing resources, uniqueness and unchanged failure rows',async()=>{
 await operatorFixture(async(_url,pool)=>{
  const repo=await fixture(pool),allowed={issue:['approved','in_progress','delivered'],submit:['estimated','approved','in_progress','on_hold','delivered'],action:['new','estimated','approved','in_progress','on_hold','delivered']};
  for(const state of ['new','estimated','approved','in_progress','on_hold','delivered','cancelled','archived']){
   await seed(repo,state);await repo.createProjectInvoice(state,invoice(state));await repo.createProjectExpense(state,expense(state,'approve'));await repo.createProjectExpense(state,expense(state,'reject'));await pool.query('UPDATE projectops_project_requests SET status=$2 WHERE id=$1',[state,state]);
   const commands=[['issue',()=>repo.createProjectInvoice(state,invoice(state,'new'))],['submit',()=>repo.createProjectExpense(state,expense(state,'new'))],['action',()=>repo.markProjectInvoicePaid(state,'i',T1)],['action',()=>repo.approveProjectExpense(state,'approve',decision)],['action',()=>repo.rejectProjectExpense(state,'reject',decision)]] as const;
   for(const [command,run]of commands){if(allowed[command].includes(state))await run();else await assert.rejects(run,conflict);}
   assert.equal((await repo.getProjectRequest(state))!.revision,4);assert.equal((await repo.getProjectInvoice(state,'i'))!.status,allowed.action.includes(state)?'paid':'issued');assert.equal((await repo.getProjectExpense(state,'approve'))!.status,allowed.action.includes(state)?'approved':'submitted');assert.equal((await repo.getProjectExpense(state,'reject'))!.status,allowed.action.includes(state)?'rejected':'submitted');
   for(const run of [()=>repo.markProjectInvoicePaid(state,'missing',T1),()=>repo.approveProjectExpense(state,'missing',decision),()=>repo.rejectProjectExpense(state,'missing',decision)])await assert.rejects(run,missing);
   assert.ok((await repo.listProjectInvoices(state)).length);assert.ok((await repo.listProjectExpenses(state)).length);
  }
  await seed(repo,'failure');await seed(repo,'other',true);
  await assert.rejects(()=>repo.createProjectInvoice('failure',{...invoice('failure'),deliverableId:'d'}),missing);
  await repo.createProjectDeliverable('failure',{id:'d',projectRequestId:'failure',title:'Artifact',artifactUrl:'https://example.test/file',submittedAtIso:T0});await assert.rejects(()=>repo.createProjectInvoice('failure',{...invoice('failure'),deliverableId:'d'}),conflict);await repo.acceptProjectDeliverable('failure','d',T1);
  await repo.createProjectInvoice('failure',{...invoice('failure'),deliverableId:'d'});await repo.createProjectInvoice('other',invoice('other'));
  await assert.rejects(()=>repo.createProjectInvoice('failure',invoice('failure')),conflict);await assert.rejects(()=>repo.createProjectInvoice('failure',{...invoice('failure','other-id'),invoiceNumber:'i'}),conflict);
  await repo.createProjectExpense('failure',expense('failure'));await assert.rejects(()=>repo.createProjectExpense('failure',expense('failure')),conflict);
  const beforeI=await repo.listProjectInvoices('failure'),beforeE=await repo.listProjectExpenses('failure');
  for(const run of [()=>repo.createProjectInvoice('missing',invoice('missing')),()=>repo.createProjectExpense('missing',expense('missing')),()=>repo.markProjectInvoicePaid('missing','i',T1),()=>repo.createProjectInvoice('failure',{...invoice('failure','bad'),dueAtIso:'2026-10-01T00:00:00.000Z'}),()=>repo.createProjectExpense('failure',{...expense('failure','bad'),receiptUrl:'javascript:alert(1)'})])await assert.rejects(run);
  assert.deepEqual(await repo.listProjectInvoices('failure'),beforeI);assert.deepEqual(await repo.listProjectExpenses('failure'),beforeE);
  // Storage constraints remain authoritative even without repository preflight reads.
  const sql=new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool)),parent=(await repo.getProjectRequest('failure'))!;
  await assert.rejects(()=>sql.query(insertProjectInvoiceSql(createProjectInvoice(parent,invoice('failure')))),conflict);
  await assert.rejects(()=>sql.query(insertProjectExpenseSql(createProjectExpense(parent,expense('failure')))),conflict);
  await repo.markProjectInvoicePaid('failure','i',T1);await assert.rejects(()=>repo.markProjectInvoicePaid('failure','i',T1),conflict);await repo.rejectProjectExpense('failure','e',decision);await assert.rejects(()=>repo.approveProjectExpense('failure','e',decision),conflict);
 });
});

test('PostgreSQL finance totals use actual currencies, exact decimal-cent strings and no join multiplication',async()=>{
 await operatorFixture(async(_url,pool)=>{
  const repo=await fixture(pool);await seed(repo,'r');await seed(repo,'second');
  for(let n=0;n<3;n++)await repo.createProjectInvoice('r',{...invoice('r','large-'+n),amountCents:1000000000});
  await repo.createProjectInvoice('r',{...invoice('r','paid'),currency:'USD',amountCents:111});await repo.markProjectInvoicePaid('r','paid',T1);
  await repo.createProjectExpense('r',{...expense('r'),currency:'EUR',amountCents:200,reimbursable:false});await repo.approveProjectExpense('r','e',decision);
  await repo.createProjectExpense('r',{...expense('r','submitted'),currency:'GBP',amountCents:300});await repo.createProjectExpense('r',{...expense('r','rejected'),currency:'GBP',amountCents:999});await repo.rejectProjectExpense('r','rejected',decision);
  await repo.createProjectInvoice('second',{...invoice('second'),currency:'EUR',amountCents:500});
  const dash=await repo.getDashboard(),row=dash.rows.find(r=>r.id==='r')!;
  assert.equal(row.estimateCurrency,'GBP');assert.equal(row.financeTotalsByCurrency!.EUR.outstandingInvoiceAmountCents,'3000000000');assert.equal(row.financeTotalsByCurrency!.EUR.approvedExpenseAmountCents,'200');assert.equal(row.financeTotalsByCurrency!.USD.paidInvoiceAmountCents,'111');assert.equal(row.financeTotalsByCurrency!.GBP.submittedExpenseAmountCents,'300');assert.equal(dash.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'3000000500');assert.equal((dash as any).outstandingInvoiceAmountCents,undefined);
  const sql=new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool));const statement=selectDashboardRowsSql();const raw=await pool.query(statement.sql,[...statement.params]);assert.equal(typeof raw.rows.find(r=>r.id==='r').finance_totals_by_currency.EUR.outstandingInvoiceAmountCents,'string');
  // Exercise the database aggregate/string normalization boundary beyond JavaScript's safe integer range.
  const exact=await sql.query<any>({sql:"SELECT jsonb_build_object('EUR',jsonb_build_object('outstandingInvoiceAmountCents',SUM(cents)::text,'paidInvoiceAmountCents','0','submittedExpenseAmountCents','0','approvedExpenseAmountCents','0')) AS finance_totals_by_currency FROM (VALUES (9007199254740993::bigint),(1::bigint)) AS amounts(cents)",params:[]});
  assert.equal(exact[0].financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'9007199254740994');
  await pool.query("UPDATE projectops_project_requests SET status='cancelled' WHERE id='second'");assert.equal((await repo.getDashboard()).financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'3000000000');assert.equal((await repo.listProjectInvoices('second')).length,1);
 });
});

async function waitLocked(pool:any,prefix:string){for(let i=0;i<250;i++){const r=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",[prefix+'%']);if(r.rows.length)return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Expected blocked query: '+prefix);}
async function parentWins(pool:any,id:string,state:string,prefix:string,run:()=>Promise<unknown>,success=false){const client=await pool.connect();try{await client.query('BEGIN');if(state==='archived')await client.query("UPDATE projectops_project_requests SET status='cancelled',revision=revision+1 WHERE id=$1",[id]);await client.query('UPDATE projectops_project_requests SET status=$2,revision=revision+1 WHERE id=$1',[id,state]);const pending=run().then(value=>({value}),error=>({error}));await waitLocked(pool,prefix);await client.query('COMMIT');const outcome:any=await pending;if(success)assert.ok(outcome.value);else assert.ok(conflict(outcome.error),String(outcome.error));}finally{await client.query('ROLLBACK');client.release();}}
async function childFirst(pool:any,statement:any,run:()=>Promise<unknown>){const client=await pool.connect();try{await client.query('BEGIN');await client.query(statement.sql,statement.params);const pending=run();await waitLocked(pool,'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE');await client.query('COMMIT');return await pending;}finally{await client.query('ROLLBACK');client.release();}}

function racingRepository(pool:any,kind:string){let reads=0,release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve),connection=projectOpsPoolConnection(pool);const repo=new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor({...connection,async query<T>(text:string,params:readonly unknown[]=[]){const result=await connection.query<T>(text,params);if(reads<2&&text.includes('FROM projectops_project_'+kind)&&text.includes('AND id = $2')){if(++reads===2)release();await barrier;}return result;}}));return {repo,reads:()=>reads};}
async function oneWinner(commands:Promise<unknown>[]){const results=await Promise.allSettled(commands);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);for(const result of results)if(result.status==='rejected')assert.ok(conflict(result.reason));}

test('Controlled PostgreSQL finance terminal and duplicate races have exactly one winner and count only committed outcomes',async()=>{
 await operatorFixture(async(_url,pool)=>{
  const repo=await fixture(pool);
  for(const pair of [['pay','pay'],['approve','approve'],['reject','reject'],['approve','reject']]){const id=pair.join('-');await seed(repo,id);await repo.createProjectInvoice(id,invoice(id));await repo.createProjectExpense(id,expense(id));const race=racingRepository(pool,pair[0]==='pay'?'invoices':'expenses');const command=(action:string)=>action==='pay'?race.repo.markProjectInvoicePaid(id,'i',T1):action==='approve'?race.repo.approveProjectExpense(id,'e',decision):race.repo.rejectProjectExpense(id,'e',decision);await oneWinner(pair.map(command));assert.equal(race.reads(),2);assert.equal((await repo.getProjectRequest(id))!.revision,4);const dash=await repo.getDashboard(),row=dash.rows.find(r=>r.id===id)!;assert.equal(row.financeTotalsByCurrency!.EUR.paidInvoiceAmountCents,pair[0]==='pay'?'100':'0');const state=(await repo.getProjectExpense(id,'e'))!.status;assert.equal(row.financeTotalsByCurrency?.USD?.approvedExpenseAmountCents,state==='approved'?'200':state==='submitted'?'0':undefined);}
  for(const kind of ['invoice-id','invoice-number','expense-id']){await seed(repo,kind);const commands=kind==='expense-id'?[repo.createProjectExpense(kind,expense(kind)),repo.createProjectExpense(kind,expense(kind))]:[repo.createProjectInvoice(kind,invoice(kind)),repo.createProjectInvoice(kind,{...invoice(kind,kind==='invoice-number'?'second':'i'),invoiceNumber:'i'})];await oneWinner(commands);const rows=kind==='expense-id'?await repo.listProjectExpenses(kind):await repo.listProjectInvoices(kind);assert.equal(rows.length,1);assert.equal((await repo.getProjectRequest(kind))!.revision,4);}
 });
});

test('Controlled PostgreSQL cancellation, archival and hold serialize all five finance writes without losing missing-resource semantics',async()=>{
 await operatorFixture(async(_url,pool)=>{
  const repo=await fixture(pool);
  const commands=['issue','submit','pay','approve','reject'];
  for(const state of ['cancelled','archived','on_hold'])for(const command of commands){const id=state+'-'+command;await seed(repo,id);if(command==='pay')await repo.createProjectInvoice(id,invoice(id));if(['approve','reject'].includes(command))await repo.createProjectExpense(id,expense(id));const run=()=>command==='issue'?repo.createProjectInvoice(id,invoice(id)):command==='submit'?repo.createProjectExpense(id,expense(id)):command==='pay'?repo.markProjectInvoicePaid(id,'i',T1):command==='approve'?repo.approveProjectExpense(id,'e',decision):repo.rejectProjectExpense(id,'e',decision);
   const prefix=command==='issue'?'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE':command==='submit'?'INSERT INTO projectops_project_expenses':command==='pay'?'UPDATE projectops_project_invoices':'UPDATE projectops_project_expenses';const succeeds=state==='on_hold'&&command!=='issue';await parentWins(pool,id,state,prefix,run,succeeds);
   const rows=command==='issue'||command==='pay'?await repo.listProjectInvoices(id):await repo.listProjectExpenses(id);assert.equal(rows.length,command==='issue'||command==='submit'?(succeeds?1:0):1);if(rows.length&&!succeeds)assert.equal(rows[0].status,command==='pay'?'issued':'submitted');
  }
 });
});

test('Controlled PostgreSQL delivery and accepted relationships observe finance serialization without adding readiness prerequisites',async()=>{
 await operatorFixture(async(_url,pool)=>{
  const repo=await fixture(pool);
  // A fresh relationship read after a blocked parent lock observes acceptance by the preceding owner.
  await seed(repo,'accepted-link');await repo.createProjectDeliverable('accepted-link',{id:'d',projectRequestId:'accepted-link',title:'Artifact',artifactUrl:'https://example.test/file',submittedAtIso:T0});const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT id FROM projectops_project_requests WHERE id='accepted-link' FOR UPDATE");await client.query("UPDATE projectops_project_deliverables SET status='accepted',accepted_at=$1 WHERE project_request_id='accepted-link'",[T1]);const issuing=repo.createProjectInvoice('accepted-link',{...invoice('accepted-link'),deliverableId:'d'});await waitLocked(pool,'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE');await client.query('COMMIT');assert.equal((await issuing).deliverableId,'d');}finally{await client.query('ROLLBACK');client.release();}
  // Finance-first writes remain visible and do not block delivery or delivered archival.
  for(const kind of ['invoice','expense']){const id='first-'+kind;await seed(repo,id,true);const parent=(await repo.getProjectRequest(id))!;const statement=kind==='invoice'?insertProjectInvoiceSql(createProjectInvoice(parent,invoice(id))):insertProjectExpenseSql(createProjectExpense(parent,expense(id)));const delivered:any=await childFirst(pool,statement,()=>repo.transitionProjectRequest(id,'delivered',T1,parent.revision));assert.equal(delivered.status,'delivered');await repo.transitionProjectRequest(id,'archived',T1,delivered.revision);assert.equal(kind==='invoice'?(await repo.listProjectInvoices(id)).length:(await repo.listProjectExpenses(id)).length,1);}
  // A paused real delivery transaction owns the parent first; all finance commands observe delivered.
  for(const command of ['issue','submit','pay','approve','reject']){const id='delivery-'+command;await seed(repo,id,true);if(command==='pay')await repo.createProjectInvoice(id,invoice(id));if(['approve','reject'].includes(command))await repo.createProjectExpense(id,expense(id));const connection=projectOpsPoolConnection(pool);let resume!:()=>void,signal!:()=>void;const locked=new Promise<void>(r=>signal=r),proceed=new Promise<void>(r=>resume=r);const paused=new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor({...connection,transaction:run=>connection.transaction!(scoped=>run({async query<T>(text:string,params:readonly unknown[]=[]){const result=await scoped.query<T>(text,params);if(text.endsWith('FOR UPDATE')){signal();await proceed;}return result;}}))}));const p=(await repo.getProjectRequest(id))!;const delivering=paused.transitionProjectRequest(id,'delivered',T1,p.revision);await locked;const pending=command==='issue'?repo.createProjectInvoice(id,invoice(id)):command==='submit'?repo.createProjectExpense(id,expense(id)):command==='pay'?repo.markProjectInvoicePaid(id,'i',T1):command==='approve'?repo.approveProjectExpense(id,'e',decision):repo.rejectProjectExpense(id,'e',decision);await waitLocked(pool,command==='issue'?'SELECT * FROM projectops_project_requests WHERE id = $1 FOR UPDATE':command==='submit'?'INSERT INTO projectops_project_expenses':command==='pay'?'UPDATE projectops_project_invoices':'UPDATE projectops_project_expenses');resume();assert.equal((await delivering).status,'delivered');assert.ok(await pending);assert.equal((await repo.getProjectRequest(id))!.revision,p.revision!+1);}
 });
});
