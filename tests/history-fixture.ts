import assert from 'node:assert/strict';
import type { ProjectOpsRepository, ProjectActivityEventType } from '../packages/projectops/src/index.ts';

export const BUSINESS_TIME = '2026-10-01T12:00:00.000Z';
export const ACTION_TIME = '2026-10-02T12:00:00.000Z';
export const AUDIT_TIME = '2026-10-03T12:00:00.000Z';

/** Exercise every approved trigger with actual business guards; retry each winning command. */
export async function historyJourney(repo: ProjectOpsRepository, actor = 'operator',
  beforeSuccess?: (command: () => Promise<unknown>, projectId: string) => Promise<void>) {
  const events = new Set<ProjectActivityEventType>();
  async function step(type: ProjectActivityEventType, command: () => Promise<unknown>, projectId = 'r') {
    const before = await repo.getProjectRequest(projectId) ? await repo.listProjectActivities(projectId) : [];
    await beforeSuccess?.(command, projectId);
    const result = await command();
    const after = await repo.listProjectActivities(projectId);
    const added = after.filter(row => !before.some(old => old.id === row.id));
    assert.equal(added.length, 1, type); const activity = added[0]!;
    assert.equal(activity.eventType, type); assert.equal(activity.projectRequestId, projectId);
    assert.equal(activity.actor, actor); assert.equal(activity.happenedAtIso, AUDIT_TIME);
    assert.equal(activity.createdAtIso, AUDIT_TIME); assert.ok(activity.summary.length <= 500);
    assert.ok(activity.summary.includes((result as { id: string }).id));
    if (type === 'status_changed') assert.match(activity.summary, /\((new|approved|in_progress|on_hold|delivered|cancelled) → (in_progress|on_hold|delivered|cancelled|archived)\)/);
    assert.match(activity.id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
    events.add(type);
    await assert.rejects(command, () => true, 'Retry must be stale, duplicate or terminal: ' + type);
    assert.deepEqual(await repo.listProjectActivities(projectId), after, 'No false retry history: ' + type);
    return result as any;
  }
  await step('request_created', () => repo.createProjectRequest({ id: 'r', clientId: 'c', title: '<b>Project</b>', brief: 'Brief', createdAtIso: BUSINESS_TIME }));
  await step('request_edited', () => repo.editProject('r', { title: 'Edited project', brief: 'Edited brief', priority: 'high', expectedRevision: 1 }, ACTION_TIME));
  await step('request_estimated', () => repo.estimateProjectRequest('r', { amountCents: 100, currency: 'GBP', estimatedAtIso: ACTION_TIME, expectedRevision: 2 }));
  await step('request_approved', () => repo.approveProjectRequest('r', { approvedBy: 'Business approver', approvedAtIso: ACTION_TIME, expectedRevision: 3 }));
  const parentRevision = (await repo.getProjectRequest('r'))!.revision;
  await step('milestone_created', () => repo.createProjectMilestone('r', { id: 'm', projectRequestId: 'r', title: 'Milestone', createdAtIso: BUSINESS_TIME }));
  await step('milestone_edited', () => repo.editProjectMilestone('r', 'm', { title: 'Scheduled milestone', dueAtIso: AUDIT_TIME, expectedRevision: 1 }, ACTION_TIME));
  await step('milestone_completed', () => repo.completeProjectMilestone('r', 'm', { completedAtIso: ACTION_TIME, expectedRevision: 2 }));
  await step('milestone_reopened', () => repo.reopenProjectMilestone('r', 'm', { reopenedAtIso: ACTION_TIME, expectedRevision: 3 }));
  await step('task_created', () => repo.createProjectTask('r', { id: 't', projectRequestId: 'r', title: 'Task', assignee: 'Business assignee', createdAtIso: BUSINESS_TIME }));
  await step('task_edited', () => repo.editProjectTask('r', 't', { title: 'Scheduled task', priority: 'high', dueAtIso: AUDIT_TIME, expectedRevision: 1 }, ACTION_TIME));
  await step('task_completed', () => repo.completeProjectTask('r', 't', { completedBy: 'Business attribution', completedAtIso: ACTION_TIME, expectedRevision: 2 }));
  await step('task_reopened', () => repo.reopenProjectTask('r', 't', { reopenedAtIso: ACTION_TIME, expectedRevision: 3 }));
  await step('work_log_added', () => repo.createProjectWorkLog('r', { id: 'w', projectRequestId: 'r', taskId: 't', actor: 'Business attribution', minutes: 30, loggedAtIso: BUSINESS_TIME }));
  await step('note_added', () => repo.createProjectNote('r', { id: 'n', projectRequestId: 'r', author: 'Source author', body: '<img src=x>' + 'x'.repeat(1500), createdAtIso: BUSINESS_TIME }));
  await step('note_archived', () => repo.archiveProjectNote('r', 'n', { archivedBy: 'Business attribution', archivedAtIso: ACTION_TIME }));
  await step('issue_created', () => repo.createProjectIssue('r', { id: 'i', projectRequestId: 'r', title: 'Issue', description: 'Issue description', openedAtIso: BUSINESS_TIME }));
  await step('issue_resolved', () => repo.resolveProjectIssue('r', 'i', { resolvedAtIso: ACTION_TIME }));
  await step('risk_created', () => repo.createProjectRisk('r', { id: 'k', projectRequestId: 'r', title: 'Risk', description: 'Risk description', identifiedAtIso: BUSINESS_TIME }));
  await step('risk_mitigated', () => repo.mitigateProjectRisk('r', 'k', { mitigatedAtIso: ACTION_TIME }));
  await step('document_added', () => repo.createProjectDocument('r', { id: 'doc', projectRequestId: 'r', title: 'Document', url: 'https://example.test/document', uploadedBy: 'Business attribution', uploadedAtIso: BUSINESS_TIME }));
  await step('document_archived', () => repo.archiveProjectDocument('r', 'doc', { archivedBy: 'Business attribution', archivedAtIso: ACTION_TIME }));
  await step('deliverable_submitted', () => repo.createProjectDeliverable('r', { id: 'd', projectRequestId: 'r', milestoneId: 'm', title: 'Artifact', artifactUrl: 'https://example.test/artifact', submittedAtIso: BUSINESS_TIME }));
  await step('deliverable_accepted', () => repo.acceptProjectDeliverable('r', 'd', ACTION_TIME));
  await step('feedback_added', () => repo.createProjectFeedback('r', { id: 'f', projectRequestId: 'r', deliverableId: 'd', author: 'Client source', message: 'Feedback', receivedAtIso: BUSINESS_TIME }));
  await step('feedback_addressed', () => repo.addressProjectFeedback('r', 'f', { addressedBy: 'Business attribution', addressedAtIso: ACTION_TIME }));
  await step('invoice_issued', () => repo.createProjectInvoice('r', { id: 'inv', projectRequestId: 'r', deliverableId: 'd', invoiceNumber: 'INV-1', amountCents: 1000000000, currency: 'EUR', issuedAtIso: BUSINESS_TIME }));
  await step('invoice_paid', () => repo.markProjectInvoicePaid('r', 'inv', ACTION_TIME));
  await step('expense_submitted', () => repo.createProjectExpense('r', { id: 'e', projectRequestId: 'r', description: 'Expense', vendor: 'Business vendor', amountCents: 200, currency: 'USD', incurredAtIso: BUSINESS_TIME }));
  await step('expense_approved', () => repo.approveProjectExpense('r', 'e', { decidedBy: 'Business attribution', decidedAtIso: ACTION_TIME }));
  await step('expense_submitted', () => repo.createProjectExpense('r', { id: 'reject', projectRequestId: 'r', description: 'Rejected expense', amountCents: 300, currency: 'USD', incurredAtIso: BUSINESS_TIME }));
  await step('expense_rejected', () => repo.rejectProjectExpense('r', 'reject', { decidedBy: 'Business attribution', decidedAtIso: ACTION_TIME }));
  assert.equal((await repo.getProjectRequest('r'))!.revision, parentRevision);
  assert.equal((await repo.getProjectMilestone('r', 'm'))!.revision, 4);
  assert.equal((await repo.getProjectTask('r', 't'))!.revision, 4);
  assert.equal((await repo.getProjectFeedback('r', 'f'))!.author, 'Client source');
  assert.equal((await repo.getProjectExpense('r', 'e'))!.incurredAtIso, BUSINESS_TIME);
  const finances = (await repo.getDashboard()).financeTotalsByCurrency;
  assert.equal(finances.EUR.paidInvoiceAmountCents, '1000000000');
  assert.equal(finances.USD.approvedExpenseAmountCents, '200');
  // Unsettled finances do not enter the Slice 9 readiness predicate.
  await repo.createProjectInvoice('r', { id: 'unpaid', projectRequestId: 'r', invoiceNumber: 'Unpaid', amountCents: 111, currency: 'JPY', issuedAtIso: BUSINESS_TIME });
  await repo.createProjectExpense('r', { id: 'undecided', projectRequestId: 'r', description: 'Submitted', amountCents: 222, currency: 'JPY', incurredAtIso: BUSINESS_TIME });
  for (const status of ['in_progress', 'on_hold', 'in_progress', 'delivered', 'archived'] as const) {
    const revision = (await repo.getProjectRequest('r'))!.revision;
    await step('status_changed', () => repo.transitionProjectRequest('r', status, ACTION_TIME, revision));
  }
  await step('request_created', () => repo.createProjectRequest({ id: 'cancel', clientId: 'c', title: 'Cancel', brief: 'Brief', createdAtIso: BUSINESS_TIME }), 'cancel');
  await step('status_changed', () => repo.transitionProjectRequest('cancel', 'cancelled', ACTION_TIME, 1), 'cancel');
  assert.equal((await repo.listProjectActivities('cancel')).length, 2);
  await step('status_changed', () => repo.transitionProjectRequest('cancel', 'archived', ACTION_TIME, 2), 'cancel');
  return events;
}

export async function historyBusinessSnapshot(repo: ProjectOpsRepository, id: string) {
  const project = await repo.getProjectRequest(id);
  if (!project) return { project };
  return { project, collections: await Promise.all([
    repo.listProjectActivities(id), repo.listProjectMilestones(id), repo.listProjectTasks(id),
    repo.listProjectWorkLogs(id), repo.listProjectNotes(id), repo.listProjectDocuments(id),
    repo.listProjectIssues(id), repo.listProjectRisks(id), repo.listProjectDeliverables(id),
    repo.listProjectFeedback(id), repo.listProjectInvoices(id), repo.listProjectExpenses(id),
  ]) };
}
