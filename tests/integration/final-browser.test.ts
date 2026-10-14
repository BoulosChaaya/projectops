import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { finalDatabaseFixture } from './final-fixture.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { ProjectOpsRepository, ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection } from '../../packages/projectops/src/index.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { startProjectOpsApp } from '../../apps/api/src/projectops/app.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsAccess } from '../../apps/api/src/projectops/access.ts';
import { backupProjectOps, restoreDisposableBackup, newRestoreDatabaseName } from '../../scripts/projectops-recovery.mjs';
import { exportCollections } from '../../packages/projectops/src/project-export.ts';

test('Final real-project Chromium journey runs intake to payment/delivery/archive, restarts, exports and verifies real backup/restored application', {timeout:120000},async()=>{
 await finalDatabaseFixture(async f=>{
  const client=await f.pool.connect();try{await migrateProjectOpsPostgres(client,await loadProjectOpsPostgresMigrations());}finally{client.release();}
  const secret=randomBytes(24).toString('base64url'),store=new ProjectOpsOperatorStore(f.pool);await store.provision('operator',secret);
  const sql=new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(f.pool)),repo=new ProjectOpsRepository(sql);
  let now='2026-10-03T09:00:00.000Z';
  const start=()=>startProjectOpsApp({sql,access:new ProjectOpsAccess(store),clock:()=>now,host:'127.0.0.1',port:0});
  let app=await start(),browser,closed=false;
  async function closeApp(){if(!closed){closed=true;await app.close();}}
  try{
   browser=await chromium.launch({headless:true});const context=await browser.newContext({timezoneId:'America/Los_Angeles',acceptDownloads:true}),page=await context.newPage();
   const errors:string[]=[];page.on('pageerror',()=>errors.push('page error'));
   await page.goto(app.server.origin+'/projectops');await page.getByLabel('Login',{exact:true}).fill('operator');await page.getByLabel('Password',{exact:true}).fill(secret);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/projectops');
   await page.getByRole('link',{name:'Operator settings',exact:true}).click();await page.waitForFunction(()=>!(document.querySelector('#defaults button') as HTMLButtonElement).disabled);
   await page.locator('#defaults [name=defaultCurrency]').fill('GBP');await page.locator('#defaults [name=defaultPriority]').selectOption('high');await page.locator('#defaults [name=timezone]').fill('Asia/Beirut');await page.locator('#defaults button').click();await page.getByText('Defaults saved.',{exact:true}).waitFor();
   async function form(selector:string,fields:Record<string,string>,type?:string){
    for(const [key,value]of Object.entries(fields)){const input=page.locator(selector+' [name='+key+']');if(await input.evaluate(e=>e.tagName==='SELECT'))await input.selectOption(value);else await input.fill(value);}
    const response=page.waitForResponse(r=>['POST','PUT'].includes(r.request().method())&&r.url().includes('/projectops/'));
    await page.locator(selector+' button').first().click();const result=await response;assert.equal(result.status(),200);const row=['#create','#create-project'].includes(selector)?undefined:await result.json();if(type)await event(type);return row;
   }
   await page.goto(app.server.origin+'/projectops/client-management');await form('#create',{name:'Acceptance studio',contactName:'Client contact',email:'acceptance@example.test'});await page.waitForURL('**/client-management/*');const c={id:page.url().split('/').at(-1)!};
   await form('#edit',{name:'Acceptance studio revised',contactName:'',email:''});await page.locator('#message').filter({hasText:'Client saved.'}).waitFor();assert.equal((await repo.getClient(c.id))!.contactName,null);
   await form('#create-project',{title:'Acceptance project',brief:'Initial brief',budgetRange:'Initial budget',deadlineIso:'2026-10-03T11:00'});await page.waitForURL('**/projects/*');const p={id:page.url().split('/').at(-1)!};
   const root='project-requests/'+p.id;let count=1;const expectedTypes=['request_created'];
   const read=(suffix:string)=>context.request.get(app.server.origin+'/projectops/'+root+suffix).then(r=>r.json());
   async function event(type:string){
    count++;expectedTypes.push(type);await page.waitForFunction(n=>document.querySelectorAll('#records-activities article').length===n,count);
    const rows=await read('/activities');assert.equal(rows.length,count);assert.deepEqual(rows.map((r:any)=>r.eventType).sort(),[...expectedTypes].sort());assert.ok(rows.every((r:any)=>['2026-10-03T09:00:00.000Z','2026-10-03T09:45:00.000Z'].includes(r.happenedAtIso)));assert.ok(rows.every((r:any)=>r.actor==='operator'&&r.createdAtIso===r.happenedAtIso));
    assert.deepEqual(await page.locator('#records-activities article').evaluateAll(elements=>elements.map(e=>(e as HTMLElement).dataset.activityId)),rows.map((r:any)=>r.id));
   }
   await page.waitForFunction(()=>document.querySelectorAll('#records-activities article').length===1);assert.equal((await read('')).priority,'high');
   await form('#edit-project',{title:'Acceptance final project',brief:'PRIVATE-BRIEF',budgetRange:'Changed budget',priority:'medium',deadlineIso:'2026-10-03T12:00'},'request_edited');
   await form('#edit-project',{budgetRange:'',deadlineIso:''},'request_edited');assert.equal((await read('')).budgetRange,undefined);assert.equal((await read('')).deadlineIso,undefined);
   await form('#edit-project',{budgetRange:'PRIVATE-BUDGET',priority:'high',deadlineIso:'2026-10-03T11:00'},'request_edited');
   await form('#estimate-form',{amount:'1000',currency:'GBP'},'request_estimated');await form('#estimate-form',{amount:'2000',currency:'GBP'},'request_estimated');
   async function action(name:string,confirmation:string,type='status_changed',status=200){
    const before=await read('/activities');await page.getByRole('button',{name,exact:true}).click();const pending=page.waitForResponse(r=>r.request().method()==='POST'&&(/\/(control|approve)$/.test(r.url())));
    await page.getByRole('button',{name:confirmation,exact:true}).click();const result=await pending;assert.equal(result.status(),status);assert.equal(result.headers()['cache-control'],'no-store');
    if(status===200)await event(type);else{assert.equal((await result.json()).code,'PROJECTOPS_DELIVERY_NOT_READY');assert.deepEqual(await read('/activities'),before);}
   }
   await action('Approve estimate','Confirm approval','request_approved');await action('Start project','Confirm start');
   const m=await form('#create-milestone',{title:'Delivery milestone',dueAtIso:'2026-10-03T10:00'},'milestone_created');
   await form('#milestones .planning-edit',{title:'Final milestone',dueAtIso:''},'milestone_edited');assert.equal((await read('/milestones'))[0].dueAtIso,undefined);
   await form('#milestones .planning-edit',{dueAtIso:'2026-10-03T10:00'},'milestone_edited');
   const t=await form('#create-task',{title:'Build task',description:'Internal build details',dueAtIso:'2026-10-03T09:30'},'task_created');
   await form('#tasks .planning-edit',{title:'Build deliverable',description:'',assignee:'operator',priority:'high',dueAtIso:''},'task_edited');assert.equal((await read('/tasks'))[0].description,null);
   await form('#tasks .planning-edit',{dueAtIso:'2026-10-03T09:30'},'task_edited');
   const review=await form('#create-task',{title:'Review task',dueAtIso:'2026-10-03T10:30'},'task_created');
   now='2026-10-03T09:45:00.000Z';await page.goto(app.server.origin+'/projectops');await page.getByText(/1 open tasks\/milestones overdue/).waitFor();await page.getByText(/Final milestone/).first().waitFor();
   const dashboard=await context.request.get(app.server.origin+'/projectops/dashboard').then(r=>r.json());assert.equal(dashboard.overdueWorkCount,1);assert.ok(JSON.stringify(dashboard).includes(m.id));
   await page.getByRole('link').filter({hasText:'· task: Build deliverable'}).click();await page.locator('#tasks').getByText('Build deliverable',{exact:true}).waitFor();
   await form('#create-work-log',{taskId:t.id,minutes:'45',note:'INTERNAL-WORK'},'work_log_added');
   async function childAction(button:any,type:string){const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/'+root+'/'));await button.click();assert.equal((await pending).status(),200);await event(type);}
   for(const taskId of [t.id,review.id])await childAction(page.locator('#tasks [data-record-id="'+taskId+'"]').getByRole('button',{name:'Complete task',exact:true}),'task_completed');
   await childAction(page.getByRole('button',{name:'Complete milestone',exact:true}),'milestone_completed');
   await form('#create-note',{body:'INTERNAL-ACCEPTANCE',visibility:'internal'},'note_added');await childAction(page.getByRole('button',{name:'Archive note',exact:true}),'note_archived');
   await form('#create-note',{body:'<b>Client handoff note</b>',visibility:'client'},'note_added');
   await form('#create-issue',{title:'Delivery issue',description:'INTERNAL-ISSUE'},'issue_created');await childAction(page.getByRole('button',{name:'Resolve issue',exact:true}),'issue_resolved');
   await form('#create-risk',{title:'Delivery risk',description:'INTERNAL-RISK'},'risk_created');await childAction(page.getByRole('button',{name:'Mitigate risk',exact:true}),'risk_mitigated');
   await form('#create-document',{title:'Auxiliary document',url:'https://example.test/internal',documentType:'other'},'document_added');await childAction(page.getByRole('button',{name:'Archive document',exact:true}),'document_archived');
   await form('#create-document',{title:'Client handoff document',url:'https://example.test/handoff',documentType:'handoff'},'document_added');
   await action('Mark delivered','Confirm delivery','status_changed',409);
   const delivery=await form('#create-deliverable',{title:'Accepted result',artifactUrl:'https://example.test/result',milestoneId:m.id},'deliverable_submitted');
   await action('Mark delivered','Confirm delivery','status_changed',409);await childAction(page.getByRole('button',{name:'Accept deliverable',exact:true}),'deliverable_accepted');
   await form('#create-feedback',{author:'Client source',message:'Client review',deliverableId:delivery.id,sentiment:'positive'},'feedback_added');await action('Mark delivered','Confirm delivery','status_changed',409);
   await page.locator('#feedback [name=responseNote]').fill('Response recorded');await childAction(page.getByRole('button',{name:'Address feedback',exact:true}),'feedback_addressed');assert.equal((await read('/feedback'))[0].addressedBy,'operator');
   await form('#create-invoice',{invoiceNumber:'FINAL-EUR',amountCents:'100000',currency:'EUR',deliverableId:delivery.id,dueAtIso:'2026-10-04T09:45'},'invoice_issued');await childAction(page.getByRole('button',{name:'Record payment',exact:true}),'invoice_paid');
   await form('#create-invoice',{invoiceNumber:'FINAL-USD',amountCents:'25000',currency:'USD'},'invoice_issued');
   await form('#create-expense',{description:'Approved cost',amountCents:'5000',currency:'USD',incurredAtIso:'2026-10-01T09:00',receiptUrl:'https://example.test/receipt'},'expense_submitted');await childAction(page.getByRole('button',{name:'Approve expense',exact:true}),'expense_approved');
   await form('#create-expense',{description:'Pending cost',amountCents:'1200',currency:'EUR'},'expense_submitted');
   const totals={EUR:{outstandingInvoiceAmountCents:'0',paidInvoiceAmountCents:'100000',submittedExpenseAmountCents:'1200',approvedExpenseAmountCents:'0'},USD:{outstandingInvoiceAmountCents:'25000',paidInvoiceAmountCents:'0',submittedExpenseAmountCents:'0',approvedExpenseAmountCents:'5000'}};
   assert.deepEqual((await repo.getProjectExportSnapshot(p.id)).financeTotalsByCurrency,totals);assert.doesNotMatch((await page.locator('#finance-totals').textContent())!,/GBP/);await page.locator('#finance-totals').getByText('Paid invoices: 1000.00 EUR',{exact:true}).waitFor();
   assert.deepEqual((await context.request.get(app.server.origin+'/projectops/dashboard').then(r=>r.json())).financeTotalsByCurrency,totals);
   await action('Mark delivered','Confirm delivery');assert.equal((await read('')).status,'delivered');
   await form('#create-annotation',{summary:'<b>Operator context</b>'},'operator_annotation');assert.equal(await page.locator('#activities b').count(),0);
   const saved=await repo.getProjectExportSnapshot(p.id);await closeApp();app=await start();closed=false;
   await page.goto(app.server.origin+'/projectops/projects/'+p.id);await page.waitForFunction(n=>document.querySelectorAll('#records-activities article').length===n,count);assert.deepEqual(await repo.getProjectExportSnapshot(p.id),saved);
   const session=await context.request.get(app.server.origin+'/projectops/access/session').then(r=>r.json());assert.deepEqual(session.defaults,{defaultCurrency:'GBP',defaultPriority:'high',timezone:'Asia/Beirut'});
   const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export project information',exact:true}).click()]);const artifact=JSON.parse(await readFile((await download.path())!,'utf8'));
   assert.equal(artifact.format,'projectops.internal-project');assert.equal(artifact.version,1);assert.equal(artifact.generatedBy,'operator');assert.deepEqual(Object.keys(artifact.collections).sort(),[...exportCollections].sort());assert.deepEqual(artifact.financeTotalsByCurrency,totals);assert.equal(artifact.collections.activities.length,count);assert.equal(artifact.collections.workLogs[0].taskId,t.id);assert.equal(artifact.collections.deliverables[0].milestoneId,m.id);assert.equal(artifact.project.estimateCurrency,'GBP');assert.equal(artifact.collections.expenses.find((e:any)=>e.status==='approved').decidedBy,'operator');assert.equal(artifact.collections.expenses.find((e:any)=>e.status==='approved').incurredAtIso,'2026-10-01T09:00:00.000Z');
   await page.getByRole('link',{name:'View delivery summary',exact:true}).click();await page.getByText('Current project status: delivered',{exact:true}).waitFor();
   const summary=(await page.locator('body').textContent())!;for(const hidden of ['PRIVATE-BRIEF','PRIVATE-BUDGET','INTERNAL-WORK','INTERNAL-ISSUE','INTERNAL-RISK','INTERNAL-ACCEPTANCE','Client review','Approved cost','Operator context','FINAL-USD'])assert.ok(!summary.includes(hidden));
   assert.match(summary,/Asia\/Beirut/);assert.match(summary,/Final milestone/);assert.equal(await page.locator('#summary-notes article').count(),1);assert.equal(await page.locator('#summary-documents article').count(),1);assert.equal(await page.locator('#summary-notes b').count(),0);assert.equal(await page.locator('#summary-deliverables a').getAttribute('rel'),'noopener noreferrer');
   await page.evaluate(()=>{(window as any).print=()=>{(window as any).printed=true;};});await page.getByRole('button',{name:'Print summary',exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).printed),true);
   await page.getByRole('link',{name:'Return to project',exact:true}).click();
   await form('#create-feedback',{author:'Client follow-up',message:'Post-delivery review'},'feedback_added');await action('Archive project','Confirm archive','status_changed',409);await childAction(page.getByRole('button',{name:'Address feedback',exact:true}),'feedback_addressed');await action('Archive project','Confirm archive');
   for(const selector of ['#create-task','#create-milestone','#create-work-log','#create-note','#create-document','#create-deliverable','#create-feedback','#create-invoice','#create-expense','#create-annotation'])assert.equal(await page.locator(selector).isVisible(),false);
   await page.reload();await page.waitForFunction(n=>document.querySelectorAll('#records-activities article').length===n,count);assert.deepEqual((await repo.getProjectExportSnapshot(p.id)).financeTotalsByCurrency,totals);
   await page.goto(app.server.origin+'/projectops');await page.getByText('No active project requests yet',{exact:false}).waitFor();
   await page.goto(app.server.origin+'/projectops/client-management/'+c.id);await page.getByRole('button',{name:'Archive client',exact:true}).click();await page.getByRole('button',{name:'Confirm archive',exact:true}).click();await page.locator('#message').filter({hasText:'Client archived.'}).waitFor();
   await page.getByRole('link',{name:'Acceptance final project',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('#records-activities article').length===n,count);assert.equal((await read('')).status,'archived');
   const terminal=await repo.getProjectExportSnapshot(p.id);assert.equal(terminal.client.status,'archived');assert.equal(terminal.project.status,'archived');
   await closeApp();
   const backup=await backupProjectOps({sourceService:'source',sourceIdentity:'final-browser-source',directory:path.join(f.directory,'backups'),env:f.env});
   const recovery=await restoreDisposableBackup({sourceService:'source',maintenanceService:'maintenance',targetDatabase:newRestoreDatabaseName(),archive:backup.archive,env:f.env,verifyApplication:async({targetDatabase}:any)=>{
    const restored=await startProjectOpsPostgresApp({databaseUrl:f.targetUrl(targetDatabase),host:'127.0.0.1',port:0}),restoredContext=await browser!.newContext({acceptDownloads:true}),restoredPage=await restoredContext.newPage();restoredPage.on('pageerror',()=>errors.push('restored page error'));
    try{
     await restoredPage.goto(restored.server.origin+'/projectops/login');await restoredPage.getByLabel('Login',{exact:true}).fill('operator');await restoredPage.getByLabel('Password',{exact:true}).fill(secret);await restoredPage.getByRole('button',{name:'Sign in',exact:true}).click();await restoredPage.waitForURL('**/projectops');
     await restoredPage.goto(restored.server.origin+'/projectops/projects/'+p.id);await restoredPage.waitForFunction(n=>document.querySelectorAll('#records-activities article').length===n,count);await restoredPage.locator('#finance-totals').getByText('Paid invoices: 1000.00 EUR',{exact:true}).waitFor();
     const [restoredDownload]=await Promise.all([restoredPage.waitForEvent('download'),restoredPage.getByRole('button',{name:'Export project information',exact:true}).click()]);const result=JSON.parse(await readFile((await restoredDownload.path())!,'utf8'));assert.deepEqual({project:result.project,client:result.client,collections:result.collections,financeTotalsByCurrency:result.financeTotalsByCurrency},terminal);
     await restoredPage.getByRole('link',{name:'View delivery summary',exact:true}).click();await restoredPage.getByText('Current project status: archived',{exact:true}).waitFor();await restoredPage.getByText('Client handoff document',{exact:true}).waitFor();
    }finally{await restoredContext.close();await restored.close();}
   }});
   assert.equal(recovery.applicationVerified,true);assert.equal(recovery.sourceUnchanged,true);assert.deepEqual(await repo.getProjectExportSnapshot(p.id),terminal);assert.deepEqual(errors,[]);
   console.log('Final acceptance: '+count+' exact automatic/annotation events; EUR/USD totals, restart, terminal export/handoff and private backup/restored Chromium PASS.');
  }finally{await browser?.close();await closeApp();}
 });
});
