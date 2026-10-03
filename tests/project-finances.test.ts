import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsMemorySqlExecutor, ProjectOpsRepository, applyProjectOpsMigrations, createProjectRequest,
  createProjectInvoice, createProjectExpense, markProjectInvoicePaid, approveProjectExpense, rejectProjectExpense,
  requireFinanceParentState, updateProjectRequestStatusSql, totalProjectFinances, mergeFinanceTotals,
  formatFinanceCents, composeProjectOpsDashboard, type ProjectRequestStatus } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../apps/api/src/projectops/access.ts';

const T0='2026-10-03T12:00:00.000Z',T1='2026-10-03T13:00:00.000Z';
const states: ProjectRequestStatus[]=['new','estimated','approved','in_progress','on_hold','delivered','cancelled','archived'];
const allowed={issue:['approved','in_progress','delivered'],submit:['estimated','approved','in_progress','on_hold','delivered'],action:['new','estimated','approved','in_progress','on_hold','delivered']};
const invoice=(id='i',projectRequestId='r')=>({id,projectRequestId,invoiceNumber:id,amountCents:100,currency:' usd ',issuedAtIso:T0});
const expense=(id='e',projectRequestId='r')=>({id,projectRequestId,description:'Cost',amountCents:200,currency:' eur ',incurredAtIso:T0});
const decision={decidedAtIso:T1,decidedBy:'operator',decisionNote:'Handled'};
const conflict=(error:any)=>error.kind==='conflict',missing=(error:any)=>error.kind==='not_found';
async function fixture(){const sql=new ProjectOpsMemorySqlExecutor();await applyProjectOpsMigrations(sql);const repo=new ProjectOpsRepository(sql);await repo.createClient({id:'c',name:'Client',createdAtIso:T0});await repo.createProjectRequest({id:'r',clientId:'c',title:'Finances',brief:'Brief',createdAtIso:T0});await repo.estimateProjectRequest('r',{amountCents:100,currency:'GBP',estimatedAtIso:T0});await repo.approveProjectRequest('r',{approvedBy:'operator',approvedAtIso:T0});return {sql,repo};}

test('Finance domain preserves field validation, defaults and terminal semantics',()=>{
 const base=createProjectRequest({id:'r',clientId:'c',title:'Finance',brief:'Brief',createdAtIso:T0});
 for(const status of states)for(const command of ['issue','submit','action'] as const){const run=()=>requireFinanceParentState({...base,status},command);if(allowed[command].includes(status))assert.doesNotThrow(run);else assert.throws(run,conflict);}
 const parent={...base,status:'approved' as const};const i=createProjectInvoice(parent,invoice());assert.equal(i.currency,'USD');assert.equal(i.status,'issued');assert.equal(i.deliverableId,undefined);
 for(const amountCents of [1,1000000000])assert.equal(createProjectInvoice(parent,{...invoice(),amountCents}).amountCents,amountCents);
 for(const patch of [{id:'bad/id'},{projectRequestId:'other'},{invoiceNumber:' '},{invoiceNumber:'x'.repeat(81)},{amountCents:0},{amountCents:1000000001},{amountCents:1.1},{currency:'US'},{currency:'U$D'},{issuedAtIso:'bad'},{dueAtIso:'bad'},{dueAtIso:'2026-10-02T00:00:00.000Z'},{deliverableId:'bad/id'}])assert.throws(()=>createProjectInvoice(parent,{...invoice(),...patch}));
 assert.equal(createProjectInvoice(parent,{...invoice(),dueAtIso:T0}).dueAtIso,T0);
 const paid=markProjectInvoicePaid(i,T1);assert.equal(paid.paidAtIso,T1);assert.throws(()=>markProjectInvoicePaid(paid,T1),conflict);assert.throws(()=>markProjectInvoicePaid(i,'bad'));
 const e=createProjectExpense(parent,expense());assert.equal(e.category,'other');assert.equal(e.reimbursable,true);assert.equal(e.currency,'EUR');assert.equal(e.vendor,undefined);
 for(const category of ['software','asset','service','travel','other'] as const)assert.equal(createProjectExpense(parent,{...expense(),category}).category,category);
 for(const patch of [{id:'bad/id'},{category:'bad'},{description:' '},{description:'x'.repeat(501)},{vendor:'x'.repeat(121)},{amountCents:0},{amountCents:1.2},{amountCents:1000000001},{currency:'ABC1'},{currency:'123'},{receiptUrl:'javascript:alert(1)'},{receiptUrl:'ftp://example.test/file'},{receiptUrl:'https://'},{receiptUrl:'https://example.test/'+'x'.repeat(2048)},{incurredAtIso:'bad'}])assert.throws(()=>createProjectExpense(parent,{...expense(),...patch} as any));
 for(const decide of [approveProjectExpense,rejectProjectExpense]){const done=decide(e,decision);assert.equal(done.decidedAtIso,T1);assert.equal(done.decidedBy,'operator');assert.throws(()=>decide(done,decision),conflict);for(const patch of [{decidedBy:''},{decidedBy:'x'.repeat(121)},{decidedAtIso:'bad'},{decisionNote:'x'.repeat(501)}])assert.throws(()=>decide(e,{...decision,...patch}));assert.equal(decide(e,{...decision,decisionNote:''}).decisionNote,undefined);}
});

test('Memory finance writes enforce all five commands across eight states and retain unchanged failure rows',async()=>{
 for(const status of states){const {sql,repo}=await fixture();await repo.createProjectInvoice('r',invoice());await repo.createProjectExpense('r',expense('approve'));await repo.createProjectExpense('r',expense('reject'));const before=(await repo.getProjectRequest('r'))!;await sql.query(updateProjectRequestStatusSql('r',status,T1,before.revision!,before.status));const revision=(await repo.getProjectRequest('r'))!.revision;
 const commands=[['issue',()=>repo.createProjectInvoice('r',invoice('second'))],['submit',()=>repo.createProjectExpense('r',expense('second'))],['action',()=>repo.markProjectInvoicePaid('r','i',T1)],['action',()=>repo.approveProjectExpense('r','approve',decision)],['action',()=>repo.rejectProjectExpense('r','reject',decision)]] as const;
 for(const [command,run]of commands){if(allowed[command].includes(status))await run();else await assert.rejects(run,conflict);}
 assert.equal((await repo.getProjectRequest('r'))!.revision,revision);assert.equal((await repo.getProjectInvoice('r','i'))!.status,allowed.action.includes(status)?'paid':'issued');assert.equal((await repo.getProjectExpense('r','approve'))!.status,allowed.action.includes(status)?'approved':'submitted');assert.equal((await repo.getProjectExpense('r','reject'))!.status,allowed.action.includes(status)?'rejected':'submitted');
 for(const run of [()=>repo.markProjectInvoicePaid('r','missing',T1),()=>repo.approveProjectExpense('r','missing',decision),()=>repo.rejectProjectExpense('r','missing',decision)])await assert.rejects(run,missing);
 assert.ok((await repo.listProjectInvoices('r')).length);assert.ok((await repo.listProjectExpenses('r')).length);
 }
});

test('Finance relationships, duplicates, one-way actions and Slice 9 readiness are preserved in memory',async()=>{
 const {repo}=await fixture();await repo.createProjectRequest({id:'other',clientId:'c',title:'Other',brief:'Brief',createdAtIso:T0});await repo.estimateProjectRequest('other',{amountCents:1,currency:'USD',estimatedAtIso:T0});await repo.approveProjectRequest('other',{approvedBy:'operator',approvedAtIso:T0});
 await repo.createProjectDeliverable('other',{id:'d',projectRequestId:'other',title:'Other',artifactUrl:'https://example.test/artifact',submittedAtIso:T0});
 await assert.rejects(()=>repo.createProjectInvoice('r',{...invoice(),deliverableId:'d'}),missing);await assert.rejects(()=>repo.createProjectInvoice('r',{...invoice(),deliverableId:'missing'}),missing);
 await repo.createProjectDeliverable('r',{id:'d',projectRequestId:'r',title:'Artifact',artifactUrl:'https://example.test/artifact',submittedAtIso:T0});await assert.rejects(()=>repo.createProjectInvoice('r',{...invoice(),deliverableId:'d'}),conflict);
 await repo.acceptProjectDeliverable('r','d',T1);await repo.createProjectInvoice('r',{...invoice(),deliverableId:'d'});await assert.rejects(()=>repo.createProjectInvoice('r',invoice()),conflict);await assert.rejects(()=>repo.createProjectInvoice('r',{...invoice('different'),invoiceNumber:'i'}),conflict);await repo.createProjectInvoice('other',invoice('i','other'));
 await repo.createProjectExpense('r',expense());await assert.rejects(()=>repo.createProjectExpense('r',expense()),conflict);assert.equal((await repo.listProjectExpenses('r')).length,1);
 // Unpaid invoices and submitted expenses do not enter delivery or archival readiness.
 let p=await repo.transitionProjectRequest('r','in_progress',T1);p=await repo.transitionProjectRequest('r','delivered',T1,p.revision);await repo.transitionProjectRequest('r','archived',T1,p.revision);
 assert.equal((await repo.getProjectInvoice('r','i'))!.status,'issued');assert.equal((await repo.getProjectExpense('r','e'))!.status,'submitted');
 for(const run of [()=>repo.createProjectInvoice('missing',invoice()),()=>repo.createProjectExpense('missing',expense()),()=>repo.markProjectInvoicePaid('missing','i',T1)])await assert.rejects(run,missing);
 const other=await repo.createProjectExpense('other',expense('e','other'));await repo.approveProjectExpense('other','e',decision);await assert.rejects(()=>repo.rejectProjectExpense('other','e',decision),conflict);assert.equal(other.status,'submitted');await repo.markProjectInvoicePaid('other','i',T1);await assert.rejects(()=>repo.markProjectInvoicePaid('other','i',T1),conflict);
});

test('Currency aggregation retains exact cents, semantic categories and actual currencies without multiplication',()=>{
 const totals=totalProjectFinances([{amountCents:1000000000,currency:'EUR',status:'issued'},{amountCents:1000000000,currency:'EUR',status:'issued'},{amountCents:1000000000,currency:'EUR',status:'issued'},{amountCents:111,currency:'USD',status:'paid'}],[{amountCents:200,currency:'EUR',status:'approved'},{amountCents:300,currency:'GBP',status:'submitted'},{amountCents:999,currency:'GBP',status:'rejected'}]);
 assert.equal(totals.EUR.outstandingInvoiceAmountCents,'3000000000');assert.equal(totals.EUR.approvedExpenseAmountCents,'200');assert.equal(totals.USD.paidInvoiceAmountCents,'111');assert.equal(totals.GBP.submittedExpenseAmountCents,'300');
 const huge={EUR:{outstandingInvoiceAmountCents:'9007199254740993',paidInvoiceAmountCents:'0',submittedExpenseAmountCents:'0',approvedExpenseAmountCents:'0'}};assert.equal(mergeFinanceTotals([huge,huge]).EUR.outstandingInvoiceAmountCents,'18014398509481986');assert.equal(formatFinanceCents('9007199254740993','EUR'),'EUR 90,071,992,547,409.93');
 const base={id:'r',clientId:'c',clientName:'Client',title:'Finances',status:'approved' as const,priority:'medium' as const,estimateCurrency:'GBP',updatedAtIso:T0};const view=composeProjectOpsDashboard([{...base,financeTotalsByCurrency:totals},{...base,id:'second',financeTotalsByCurrency:huge}]);assert.equal(view.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'9007202254740993');assert.equal((view as any).outstandingInvoiceAmountCents,undefined);
});

test('Protected finance routes enforce access, deterministic errors and approved timestamp/operator ownership',async()=>{
 const session={login:'operator',csrfToken:'csrf',tokenHash:'hash',defaults:{defaultCurrency:'USD',defaultPriority:'medium',timezone:'UTC'}};
 const access=new ProjectOpsAccess({async resolve(token:string){return token==='valid'?session:null;}} as any);
 const app=await startProjectOpsApp({sql:new ProjectOpsMemorySqlExecutor(),port:0,clock:()=>T1,access});
 const headers={cookie:'projectops_session=valid',origin:app.server.origin,'content-type':'application/json','x-csrf-token':'csrf'};
 const send=(path:string,body:unknown,extra={})=>fetch(app.server.origin+'/projectops/'+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 const ok=async(path:string,body:unknown)=>{const r=await send(path,body);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');return r.json();};
 try{
  await ok('clients',{id:'c',name:'Client'});await ok('project-requests',{id:'r',clientId:'c',title:'Finance',brief:'Brief'});
  for(const path of ['invoices','invoices/i/pay','expenses','expenses/e/approve','expenses/e/reject']){
   for(const [extra,status]of [[{cookie:''},401],[{origin:'https://evil.test'},403],[{'x-csrf-token':''},403],[{'content-type':'text/plain'},415]] as const)assert.equal((await send('project-requests/r/'+path,{},extra)).status,status);
  }
  const root='project-requests/r';assert.equal((await send(root+'/invoices',invoice())).status,409);assert.equal((await send(root+'/expenses',expense())).status,409);
  await ok(root+'/estimate',{amountCents:100,currency:'GBP'});await ok(root+'/approve',{approvedBy:'operator'});
  for(const patch of [{amountCents:0},{amountCents:1.5},{amountCents:1000000001},{currency:'$$$'},{invoiceNumber:' '},{dueAtIso:T0},{dueAtIso:'bad'}])assert.equal((await send(root+'/invoices',{...invoice(),...patch})).status,400);
  for(const patch of [{category:'bad'},{description:' '},{receiptUrl:'javascript:alert(1)'},{incurredAtIso:'bad'},{reimbursable:'yes'}])assert.equal((await send(root+'/expenses',{...expense(),...patch})).status,400);
  assert.equal((await send(root+'/invoices',{...invoice(),deliverableId:'missing'})).status,404);
  await ok(root+'/deliverables',{id:'d',title:'Artifact',artifactUrl:'https://example.test/file'});assert.equal((await send(root+'/invoices',{...invoice(),deliverableId:'d'})).status,409);await ok(root+'/deliverables/d/accept',{});
  const i=await ok(root+'/invoices',{...invoice(),deliverableId:'d',issuedAtIso:'invalid',dueAtIso:'2026-10-04T00:00:00.000Z'});assert.equal(i.issuedAtIso,T1);assert.equal(i.dueAtIso,'2026-10-04T00:00:00.000Z');
  assert.equal((await send(root+'/invoices',invoice())).status,409);assert.equal((await send(root+'/invoices',{...invoice('different'),invoiceNumber:'i'})).status,409);
  const paid=await ok(root+'/invoices/i/pay',{paidAtIso:'invalid'});assert.equal(paid.paidAtIso,T1);assert.equal((await send(root+'/invoices/i/pay',{})).status,409);
  const e=await ok(root+'/expenses',{...expense(),incurredAtIso:T0});assert.equal(e.incurredAtIso,T0);assert.equal(e.reimbursable,true);assert.equal(e.category,'other');
  const second=await ok(root+'/expenses',{...expense('second'),incurredAtIso:undefined});assert.equal(second.incurredAtIso,T1);
  assert.equal((await send(root+'/expenses',expense())).status,409);
  for(const action of ['approve','reject']){const row=await ok(root+'/expenses/'+(action==='approve'?'e':'second')+'/'+action,{decidedBy:'imposter',decidedAtIso:'invalid',decisionNote:'Handled'});assert.equal(row.decidedBy,'operator');assert.equal(row.decidedAtIso,T1);assert.equal((await send(root+'/expenses/'+row.id+'/'+action,{})).status,409);}
  for(const path of ['invoices/missing/pay','expenses/missing/approve','expenses/missing/reject'])assert.equal((await send(root+'/'+path,{})).status,404);
  assert.equal((await send(root+'/invoices/bad%2Fid/pay',{})).status,400);assert.equal((await send(root+'/expenses/bad%2Fid/reject',{})).status,400);
  await ok(root+'/invoices',invoice('unpaid'));await ok(root+'/expenses',expense('undecided'));await ok(root+'/control',{action:'start',expectedRevision:3});
  await ok(root+'/feedback',{id:'f',author:'Client',message:'Open'});
  for(const path of ['status','control'])assert.equal((await send(root+'/'+path,path==='status'?{status:'delivered',expectedRevision:4}:{action:'deliver',expectedRevision:4})).status,409);
  await ok(root+'/feedback/f/address',{});await ok(root+'/status',{status:'delivered',expectedRevision:4});await ok(root+'/control',{action:'archive',expectedRevision:5});
  assert.equal((await send(root+'/invoices/missing/pay',{})).status,404);
  assert.equal((await send(root+'/expenses/missing/approve',{})).status,404);
  const read=await fetch(app.server.origin+'/projectops/'+root+'/invoices',{headers});assert.equal(read.headers.get('cache-control'),'no-store');assert.equal((await read.json()).length,2);
 }finally{await app.close();}
});

test('Memory finance concurrency mirrors one-winner terminal and duplicate conflict semantics',async()=>{
 const oneWinner=async(commands:Promise<unknown>[])=>{const outcomes=await Promise.allSettled(commands);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);for(const o of outcomes)if(o.status==='rejected')assert.ok(conflict(o.reason));};
 for(const pair of [['pay','pay'],['approve','approve'],['reject','reject'],['approve','reject']]){const {repo}=await fixture();await repo.createProjectInvoice('r',invoice());await repo.createProjectExpense('r',expense());const command=(action:string)=>action==='pay'?repo.markProjectInvoicePaid('r','i',T1):action==='approve'?repo.approveProjectExpense('r','e',decision):repo.rejectProjectExpense('r','e',decision);await oneWinner(pair.map(command));assert.equal((await repo.getProjectRequest('r'))!.revision,3);}
 const {repo}=await fixture();await oneWinner([repo.createProjectInvoice('r',invoice()),repo.createProjectInvoice('r',invoice())]);await oneWinner([repo.createProjectExpense('r',expense()),repo.createProjectExpense('r',expense())]);await oneWinner([repo.createProjectInvoice('r',{...invoice('second'),invoiceNumber:'same'}),repo.createProjectInvoice('r',{...invoice('third'),invoiceNumber:'same'})]);assert.equal((await repo.listProjectInvoices('r')).length,2);assert.equal((await repo.listProjectExpenses('r')).length,1);
});
