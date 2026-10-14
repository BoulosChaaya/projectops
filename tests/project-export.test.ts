import {test}from'node:test';import assert from'node:assert/strict';
import {ProjectOpsRepository,ProjectOpsMemorySqlExecutor,applyProjectOpsMigrations}from'../packages/projectops/src/index.ts';
import {exportCollections,exportFields,composeProjectExportSnapshot,createProjectExportArtifact,projectExportFilename,orderExportCollection,validateExportIdentifier}from'../packages/projectops/src/project-export.ts';
import {renderDeliverySummary}from'../apps/web/src/projectops/project-handoff.ts';
import {ProjectOpsAccess}from'../apps/api/src/projectops/access.ts';import {startProjectOpsApp}from'../apps/api/src/projectops/app.ts';
import {seedExport,assertExport,CREATED,ACTION,AUDIT,states}from'./export-fixture.ts';import type {OperatorDefaults}from'../packages/projectops/src/operator.ts';
async function fixture(){const sql=new ProjectOpsMemorySqlExecutor();await applyProjectOpsMigrations(sql);const base=new ProjectOpsRepository(sql);await base.createClient({id:'c',name:'Client Élan',createdAtIso:CREATED});const repo=base.withHistory({actor:'operator',clock:()=>AUDIT});return{sql,base,repo};}
test('Internal export allowlists all thirteen collections, scopes projects, canonicalizes null/ISO and preserves exact money without mutations',async()=>{
 const{sql,base,repo}=await fixture();await seedExport(repo);await seedExport(repo,'other');await base.createClient({id:'unrelated',name:'PRIVATE-OTHER-CLIENT',createdAtIso:CREATED});
 const before=sql.snapshot(),snap=await repo.getProjectExportSnapshot('r');assertExport(snap);assert.deepEqual(await repo.getProjectExportSnapshot('r'),snap);assert.deepEqual(sql.snapshot(),before);
 const artifact=createProjectExportArtifact(snap,'operator',AUDIT);assert.equal(artifact.format,'projectops.internal-project');assert.equal(artifact.version,1);assert.equal(artifact.generatedBy,'operator');assert.equal(artifact.generatedAtIso,AUDIT);assert.deepEqual(JSON.parse(JSON.stringify(artifact)),artifact);
 assert.equal(snap.collections.tasks[0].assignee,null);assert.equal(snap.collections.tasks[0].revision,1);assert.equal(snap.project.deadlineIso,null);assert.equal(snap.client.email,null);
 assert.equal(JSON.stringify(artifact).includes('PRIVATE-OTHER-CLIENT'),false);
 for(const kind of exportCollections)assert.deepEqual(Object.keys(snap.collections[kind][0]),[...exportFields[kind]]);
 const raw=structuredClone(snap)as any;raw.project.password='SECRET';raw.client.csrfToken='SECRET';raw.collections.tasks[0].sessionToken='SECRET';raw.project.createdAtIso='2026-10-01T14:00:00+02:00';raw.collections.activities[0].actor=null;
 const clean=composeProjectExportSnapshot(raw);assert.equal(JSON.stringify(clean).includes('SECRET'),false);assert.equal(clean.project.createdAtIso,CREATED);assert.equal(clean.collections.activities[0].actor,null);
 delete raw.collections.notes;assert.throws(()=>composeProjectExportSnapshot(raw),/Missing snapshot collection/);
 assert.throws(()=>createProjectExportArtifact(snap,'',AUDIT));assert.throws(()=>createProjectExportArtifact(snap,'operator','invalid'));
 const rows=Array.from({length:10},(_,i)=>({...snap.collections.invoices[0],id:'large'+i,amountCents:1000000000}));
 const large={...snap,collections:{...snap.collections,invoices:rows}};assert.equal(composeProjectExportSnapshot(large).financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'10000000000');
 const {formatFinanceCents,mergeFinanceTotals}=await import('../packages/projectops/src/finances.ts');assert.equal(formatFinanceCents(mergeFinanceTotals([{EUR:{outstandingInvoiceAmountCents:'9007199254740993',paidInvoiceAmountCents:'0',submittedExpenseAmountCents:'0',approvedExpenseAmountCents:'0'}}]).EUR.outstandingInvoiceAmountCents,'EUR'),'EUR 90,071,992,547,409.93');
});
test('Export availability spans all eight states and archived clients, empty and larger collections; order uses instants and stable IDs',async()=>{
 const{sql,base,repo}=await fixture();for(const state of states){await seedExport(repo,state,state);assert.equal((await repo.getProjectExportSnapshot(state)).project.status,state);}await base.archiveClient('c',1);assert.equal((await repo.getProjectExportSnapshot('archived')).client.status,'archived');
 const empty=await repo.getProjectExportSnapshot('new');assert.ok(exportCollections.every(k=>empty.collections[k].length=== (k==='activities'?1:0)));
 for(let i=0;i<300;i++)await repo.createProjectTask('approved',{id:'bulk-'+i,projectRequestId:'approved',title:'Bulk '+i,createdAtIso:CREATED});const before=sql.snapshot();assert.equal((await repo.getProjectExportSnapshot('approved')).collections.tasks.length,301);assert.deepEqual(sql.snapshot(),before);
 const row={id:'z',dueAtIso:'2026-10-03T14:00:00+02:00',createdAtIso:CREATED};assert.deepEqual(orderExportCollection('tasks',[row,{...row,id:'a',dueAtIso:AUDIT},{...row,id:'earlier',dueAtIso:ACTION},{...row,id:'no-date',dueAtIso:null}]).map(r=>r.id),['earlier','a','z','no-date']);
 assert.deepEqual(orderExportCollection('activities',[{id:'z',happenedAtIso:AUDIT,createdAtIso:CREATED},{id:'a',happenedAtIso:'2026-10-03T14:00:00+02:00',createdAtIso:CREATED},{id:'newer',happenedAtIso:AUDIT,createdAtIso:ACTION}]).map(r=>r.id),['newer','a','z']);
 for(const bad of ['../x','a/b','a\\b','a\r\nX: injected','a'.repeat(81),''])assert.throws(()=>projectExportFilename(bad));assert.equal(projectExportFilename('A.b:c-d_e'),'projectops-project-A_b_c-d_e.json');assert.equal(validateExportIdentifier('a'.repeat(80)).length,80);
 await assert.rejects(()=>repo.getProjectExportSnapshot('missing'),(e:any)=>e.kind==='not_found');
});
test('Handoff disclosure includes only approved selections with safe text/links, milestone context, timezone and honest state/print language',async()=>{
 const{repo}=await fixture();await seedExport(repo);const snap=await repo.getProjectExportSnapshot('r'),artifact=createProjectExportArtifact(snap,'operator',AUDIT);const html=String(renderDeliverySummary(artifact,'Asia/Beirut').body);
 assert.match(html,/CURRENT \/ DRAFT/);assert.match(html,/Current project status: approved/);assert.match(html,/Linked milestone/);assert.match(html,/Timezone: Asia\/Beirut/);assert.match(html,/3:00 PM/);assert.match(html,/@media print/);assert.match(html,/window.print/);assert.match(html,/noopener noreferrer/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);
 for(const excluded of ['INTERNAL-BRIEF','PRIVATE-BUDGET','INTERNAL-TASK','INTERNAL-WORK','INTERNAL-ISSUE','INTERNAL-RISK','internal-note','archived-client-note','general-doc','archived-handoff','INTERNAL-FEEDBACK','INTERNAL-EXPENSE','INTERNAL-CHANGE','UNACCEPTED','financeTotalsByCurrency','operator_annotation','acceptedBy','deliveredAtIso'])assert.equal(html.includes(excluded),false,excluded);
 const unsafe={...artifact,collections:{...artifact.collections,deliverables:artifact.collections.deliverables.map(r=>({...r,artifactUrl:'javascript:alert(1)'})),documents:artifact.collections.documents.map(r=>({...r,url:'https://user:secret@example.test/x'}))}};const safe=String(renderDeliverySummary(unsafe,'UTC').body);assert.doesNotMatch(safe,/href="javascript:|user:secret/);assert.match(safe,/Link unavailable/);
 for(const status of states){const text=String(renderDeliverySummary({...artifact,project:{...artifact.project,status}},'UTC').body);assert.match(text,new RegExp('Current project status: '+status.replaceAll('_',' ')));assert.equal(text.includes('CURRENT / DRAFT'),!['delivered','archived'].includes(status));if(status==='archived')assert.match(text,/no prior delivery state is inferred/);}
 const empty=String(renderDeliverySummary({...artifact,collections:{...artifact.collections,deliverables:[],notes:[],documents:[]}},'UTC').body);for(const text of ['No accepted deliverables','No active client notes','No active handoff documents'])assert.ok(empty.includes(text));
});
test('Protected artifact routes own generation context and classify access, query, source and encoding failures without partial downloads',async()=>{
 const{sql,repo}=await fixture();await seedExport(repo);let fail=false,reads=0;const session={login:'operator',csrfToken:'csrf',tokenHash:'hash',defaults:{defaultCurrency:'EUR',defaultPriority:'medium' as const,timezone:'Asia/Beirut'}};
 const access=new ProjectOpsAccess({resolve:async token=>token==='valid'?session:null,login:async()=>null,logout:async()=>{},saveDefaults:async (v:OperatorDefaults)=>v,changeCredentials:async()=>false});
 const app=await startProjectOpsApp({sql:{transaction:r=>sql.transaction(r),query:async s=>{if(s.sql.startsWith('WITH project_export')){reads++;if(fail)throw Error('SECRET storage failure');}return sql.query(s);}},access,clock:()=>AUDIT,host:'127.0.0.1',port:0});
 try{const get=(path:string,auth=true)=>fetch(app.server.origin+path,{headers:auth?{cookie:'projectops_session=valid'}:{},redirect:'manual'}),root='/projectops/project-requests/r/export',summary='/projectops/projects/r/delivery-summary';const before=sql.snapshot();
 assert.equal((await get(root,false)).status,401);assert.equal((await get(summary,false)).status,302);
 const response=await get(root);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');assert.equal(response.headers.get('content-disposition'),'attachment; filename="projectops-project-r.json"');assert.equal(response.headers.get('x-content-type-options'),'nosniff');const data=await response.json();assert.equal(data.generatedBy,'operator');assert.equal(data.generatedAtIso,AUDIT);assertExport(data);assert.equal(reads,1);
 assert.equal((await get(summary)).headers.get('content-type'),'text/html; charset=utf-8');
 for(const query of ['generatedBy=spoof','generatedAtIso=2000-01-01','include=password','timezone=UTC'])for(const path of [root,summary])assert.equal((await get(path+'?'+query)).status,400);
 for(const suffix of ['project-requests/bad%20id/export','projects/bad%20id/delivery-summary'])assert.equal((await get('/projectops/'+suffix)).status,400);
 for(const suffix of ['project-requests/missing/export','projects/missing/delivery-summary'])assert.equal((await get('/projectops/'+suffix)).status,404);
 fail=true;for(const path of [root,summary]){const r=await get(path);assert.equal(r.status,500);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('content-disposition'),null);const text=await r.text();assert.doesNotMatch(text,/SECRET/);assert.match(text,/unavailable/);}fail=false;assert.equal((await get(root)).status,200);assert.deepEqual(sql.snapshot(),before);
 const denied=await fetch(app.server.origin+'/projectops/project-requests/r',{method:'PUT',headers:{cookie:'projectops_session=valid','content-type':'application/json'},body:'{}'});assert.equal(denied.status,403);assert.deepEqual(sql.snapshot(),before);
 }finally{await app.close();}
});
test('Artifact encoding/rendering failures are unavailable responses without attachment headers or partial source content',async()=>{
 const{repo}=await fixture();await seedExport(repo);const snapshot=await repo.getProjectExportSnapshot('r');
 const {createProjectHandoffRoutes}=await import('../apps/web/src/projectops/project-handoff-routes.ts');
 const huge={...snapshot,financeTotalsByCurrency:{EUR:{outstandingInvoiceAmountCents:'9007199254740994',paidInvoiceAmountCents:'0',submittedExpenseAmountCents:'0',approvedExpenseAmountCents:'0'}}};
 const encoded=JSON.parse(JSON.stringify(createProjectExportArtifact(huge,'operator',AUDIT)));assert.equal(encoded.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'9007199254740994');
 const forged=createProjectExportArtifact({...snapshot,generatedBy:'spoof',generatedAtIso:'bad',format:'spoof',version:99}as any,'operator',AUDIT);assert.equal(forged.generatedBy,'operator');assert.equal(forged.generatedAtIso,AUDIT);assert.equal(forged.version,1);
 const routes=createProjectHandoffRoutes({getProjectExportSnapshot:async()=>({...snapshot,financeTotalsByCurrency:{EUR:{outstandingInvoiceAmountCents:1n}}}as any)},()=>AUDIT);
 const context={get:()=>({login:'operator',defaults:{timezone:'not-a-timezone'}})}as any;
 for(const route of routes){const response:any=await route.handler({query:{}}as any,context,{id:'r'});assert.equal(response.status,500);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['content-disposition'],undefined);assert.doesNotMatch(response.body,/INTERNAL-BRIEF|Client source|PRIVATE-BUDGET/);assert.match(response.body,/unavailable/);}
});
