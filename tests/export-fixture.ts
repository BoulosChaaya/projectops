import assert from 'node:assert/strict';
import type { ProjectOpsRepository, ProjectRequestStatus } from '../packages/projectops/src/index.ts';
import { exportCollections, exportFields, type ProjectExportSnapshot } from '../packages/projectops/src/project-export.ts';
export const CREATED='2026-10-01T12:00:00.000Z',ACTION='2026-10-02T12:00:00.000Z',AUDIT='2026-10-03T12:00:00.000Z';
export const states: readonly ProjectRequestStatus[]=['new','estimated','approved','in_progress','on_hold','delivered','cancelled','archived'];
export const special='Élan "quoted", line\n<script>alert(1)</script>';
export async function seedExport(repo:ProjectOpsRepository,id='r',state:ProjectRequestStatus='approved') {
  await repo.createProjectRequest({id,clientId:'c',title:special,brief:'INTERNAL-BRIEF',budgetRange:'PRIVATE-BUDGET',createdAtIso:CREATED});
  if(state==='new')return;
  await repo.estimateProjectRequest(id,{amountCents:123,currency:'GBP',estimatedAtIso:ACTION});
  await repo.createProjectTask(id,{id:'task',projectRequestId:id,title:'INTERNAL-TASK',dueAtIso:AUDIT,createdAtIso:CREATED});
  await repo.createProjectWorkLog(id,{id:'work',projectRequestId:id,taskId:'task',actor:'Work source',minutes:30,note:'INTERNAL-WORK',loggedAtIso:CREATED});
  for(const [key,visibility,archived]of [['client-note','client',false],['internal-note','internal',false],['archived-client-note','client',true]]as const){
    await repo.createProjectNote(id,{id:key,projectRequestId:id,author:'Note source',visibility,body:key==='client-note'?special:key,createdAtIso:CREATED});
    if(archived)await repo.archiveProjectNote(id,key,{archivedAtIso:ACTION,archivedBy:'operator'});
  }
  await repo.createProjectIssue(id,{id:'issue',projectRequestId:id,title:'INTERNAL-ISSUE',description:'Issue',openedAtIso:CREATED});
  await repo.createProjectRisk(id,{id:'risk',projectRequestId:id,title:'INTERNAL-RISK',description:'Risk',identifiedAtIso:CREATED});
  for(const[key,documentType,archived]of [['handoff-doc','handoff',false],['general-doc','other',false],['archived-handoff','handoff',true]]as const){
    await repo.createProjectDocument(id,{id:key,projectRequestId:id,title:key,documentType,url:'https://example.test/'+key,uploadedBy:'operator',uploadedAtIso:CREATED});
    if(archived)await repo.archiveProjectDocument(id,key,{archivedAtIso:ACTION,archivedBy:'operator'});
  }
  if(state==='estimated')return;
  await repo.approveProjectRequest(id,{approvedBy:'Business approver',approvedAtIso:ACTION});
  await repo.createProjectMilestone(id,{id:'milestone',projectRequestId:id,title:'Linked milestone',dueAtIso:AUDIT,createdAtIso:CREATED});
  for(const key of ['accepted','unlinked']){
    await repo.createProjectDeliverable(id,{id:key,projectRequestId:id,milestoneId:key==='accepted'?'milestone':undefined,title:key,artifactUrl:'https://example.test/'+key,submittedAtIso:CREATED});
    await repo.acceptProjectDeliverable(id,key,ACTION);
  }
  if(state==='approved')await repo.createProjectDeliverable(id,{id:'submitted',projectRequestId:id,title:'UNACCEPTED',artifactUrl:'https://example.test/submitted',submittedAtIso:CREATED});
  await repo.createProjectFeedback(id,{id:'feedback',projectRequestId:id,deliverableId:'accepted',author:'Client source',message:'INTERNAL-FEEDBACK',receivedAtIso:CREATED});
  await repo.addressProjectFeedback(id,'feedback',{addressedBy:'operator',responseNote:'Response',addressedAtIso:ACTION});
  for(const[key,currency,paid,amountCents]of [['eur','EUR',false,1000000000],['eur2','EUR',false,1000000000],['usd','USD',true,123]]as const){
    await repo.createProjectInvoice(id,{id:key,projectRequestId:id,deliverableId:key==='eur'?'accepted':undefined,invoiceNumber:key,amountCents,currency,issuedAtIso:CREATED,dueAtIso:key==='eur'?AUDIT:undefined});
    if(paid)await repo.markProjectInvoicePaid(id,key,ACTION);
  }
  for(const[key,currency,decision]of [['submitted','JPY',null],['approved','USD','approved'],['rejected','USD','rejected']]as const){
    await repo.createProjectExpense(id,{id:key,projectRequestId:id,description:'INTERNAL-EXPENSE-'+key,amountCents:100,currency,reimbursable:false,incurredAtIso:CREATED});
    if(decision)await(decision==='approved'?repo.approveProjectExpense(id,key,{decidedBy:'operator',decidedAtIso:ACTION}):repo.rejectProjectExpense(id,key,{decidedBy:'operator',decidedAtIso:ACTION}));
  }
  await repo.createProjectChangeRequest(id,{id:'change',projectRequestId:id,title:'INTERNAL-CHANGE',description:'Change',requestedBy:'Client source',requestedAtIso:CREATED});
  if(['in_progress','on_hold','delivered'].includes(state))await repo.transitionProjectRequest(id,'in_progress',ACTION);
  if(state==='on_hold')await repo.transitionProjectRequest(id,'on_hold',ACTION);
  if(state==='delivered')await repo.transitionProjectRequest(id,'delivered',ACTION);
  if(state==='cancelled'||state==='archived')await repo.transitionProjectRequest(id,'cancelled',ACTION);
  if(state==='archived')await repo.transitionProjectRequest(id,'archived',ACTION);
}
export function assertExport(snapshot:ProjectExportSnapshot,id='r') {
  assert.equal(snapshot.project.id,id);assert.equal(snapshot.client.id,'c');assert.equal(snapshot.project.title,special);
  assert.deepEqual(Object.keys(snapshot.collections).sort(),[...exportCollections].sort());
  for(const kind of exportCollections){assert.ok(snapshot.collections[kind].length>0,kind);for(const row of snapshot.collections[kind]){assert.equal(row.projectRequestId,id);assert.deepEqual(Object.keys(row),[...exportFields[kind]]);}}
  assert.equal(snapshot.collections.workLogs[0].taskId,'task');assert.equal(snapshot.collections.deliverables.find(r=>r.id==='accepted')!.milestoneId,'milestone');
  assert.equal(snapshot.collections.feedback[0].author,'Client source');assert.equal(snapshot.collections.feedback[0].deliverableId,'accepted');
  assert.equal(snapshot.collections.invoices.find(r=>r.id==='eur')!.deliverableId,'accepted');
  assert.equal(snapshot.collections.expenses[0].incurredAtIso,CREATED);
  assert.equal(snapshot.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents,'2000000000');assert.equal(snapshot.financeTotalsByCurrency.USD.paidInvoiceAmountCents,'123');assert.equal(snapshot.financeTotalsByCurrency.USD.approvedExpenseAmountCents,'100');assert.equal(snapshot.financeTotalsByCurrency.USD.submittedExpenseAmountCents,'0');assert.equal(snapshot.financeTotalsByCurrency.JPY.submittedExpenseAmountCents,'100');
}
