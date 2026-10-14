import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { computeMigrationChecksum } from '../packages/db/src/migrations/index.ts';
import {
  ProjectOpsMemorySqlExecutor,
  ProjectOpsRepository,
  applyProjectOpsMigrations,
  projectOpsFoundationMigration,
  projectOpsSchemaSql,
  type ProjectOpsDashboardView,
  type ProjectDeliverable,
  type ProjectDocument,
  type ProjectExpense,
  type ProjectFeedback,
  type ProjectInvoice,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectRequest,
  type ProjectRisk,
  type ProjectTask,
  type ProjectWorkLog,
} from '../packages/projectops/src/index.ts';
import { createProjectOpsRoutes } from '../apps/api/src/projectops/routes.ts';
import { createProjectOpsRepositoryService } from '../apps/api/src/projectops/service.ts';
import { startHttpListener } from '../apps/api/src/bootstrap/http-listener.ts';

const T0 = '2026-09-29T08:00:00.000Z';
const T1 = '2026-09-29T09:00:00.000Z';
const T2 = '2026-09-29T10:00:00.000Z';
const T3 = '2026-09-29T11:00:00.000Z';

unitTest('PROJECTOPS-PERSIST-001: migration artifact matches source schema contract', () => {
  assert.equal(projectOpsFoundationMigration.version, '0001');
  assert.equal(projectOpsFoundationMigration.name, 'projectops_foundation');
  assert.equal(projectOpsFoundationMigration.upSql, projectOpsSchemaSql.join(';\n\n'));
  assert.equal(
    computeMigrationChecksum(projectOpsFoundationMigration.upSql).length,
    64
  );
});

unitTest('PROJECTOPS-PERSIST-002: repository requires migration before executing product SQL', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  const repo = new ProjectOpsRepository(sql);

  await assert.rejects(
    () =>
      repo.createClient({
        id: 'client-1',
        name: 'Zad Studio',
        createdAtIso: T0,
      }),
    /schema has not been migrated/
  );

  await applyProjectOpsMigrations(sql);
  const client = await repo.createClient({
    id: 'client-1',
    name: 'Zad Studio',
    createdAtIso: T0,
  });

  assert.equal(client.id, 'client-1');
  assert.equal(sql.snapshot().clients.length, 1);
});

unitTest('PROJECTOPS-PERSIST-003: repository persists client, request, transition, and dashboard state', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  await applyProjectOpsMigrations(sql);

  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({
    id: 'client-1',
    name: 'Zad Studio',
    createdAtIso: T0,
  });
  await repo.createProjectRequest({
    id: 'req-1',
    clientId: 'client-1',
    title: 'Persistent ProjectOps',
    brief: 'Prove request state survives through repository storage.',
    priority: 'high',
    createdAtIso: T0,
  });

  const transitioned = await repo.estimateProjectRequest('req-1', {
    amountCents: 320000,
    currency: 'USD',
    estimatedAtIso: T1,
  });
  const approved = await repo.approveProjectRequest('req-1', {
    approvedBy: 'Boulos',
    approvedAtIso: T2,
  });
  const milestone = await repo.createProjectMilestone('req-1', {
    id: 'milestone-1',
    projectRequestId: 'req-1',
    title: 'Deliver first draft',
    dueAtIso: T3,
    createdAtIso: T2,
  });
  const completedMilestone = await repo.completeProjectMilestone('req-1', 'milestone-1', T3);
  const deliverable = await repo.createProjectDeliverable('req-1', {
    id: 'deliverable-1',
    projectRequestId: 'req-1',
    milestoneId: 'milestone-1',
    title: 'Accepted handoff',
    artifactUrl: 'https://example.com/projectops/accepted-handoff',
    submittedAtIso: T3,
  });
  const acceptedDeliverable = await repo.acceptProjectDeliverable('req-1', 'deliverable-1', T3);
  const deliverables = await repo.listProjectDeliverables('req-1');
  const invoice = await repo.createProjectInvoice('req-1', {
    id: 'invoice-1',
    projectRequestId: 'req-1',
    deliverableId: 'deliverable-1',
    invoiceNumber: 'INV-001',
    amountCents: 320000,
    currency: 'USD',
    issuedAtIso: T3,
  });
  const paidInvoice = await repo.markProjectInvoicePaid('req-1', 'invoice-1', T3);
  const invoices = await repo.listProjectInvoices('req-1');
  const changeRequest = await repo.createProjectChangeRequest('req-1', {
    id: 'change-1',
    projectRequestId: 'req-1',
    title: 'Add analytics event tracking',
    description: 'Track contact form conversions after launch.',
    requestedBy: 'Boulos',
    estimateDeltaCents: 45000,
    estimateCurrency: 'USD',
    requestedAtIso: T3,
  });
  const approvedChangeRequest = await repo.approveProjectChangeRequest('req-1', 'change-1', {
    decidedBy: 'Client',
    decidedAtIso: T3,
    decisionNote: 'Approved for launch reporting.',
  });
  const changeRequests = await repo.listProjectChangeRequests('req-1');
  const issue = await repo.createProjectIssue('req-1', {
    id: 'issue-1',
    projectRequestId: 'req-1',
    title: 'Waiting on launch assets',
    description: 'Client still needs to send final launch images.',
    severity: 'high',
    owner: 'Client',
    openedAtIso: T3,
  });
  const resolvedIssue = await repo.resolveProjectIssue('req-1', 'issue-1', {
    resolvedAtIso: T3,
    resolutionNote: 'Assets received.',
  });
  const issues = await repo.listProjectIssues('req-1');
  const risk = await repo.createProjectRisk('req-1', {
    id: 'risk-1',
    projectRequestId: 'req-1',
    title: 'Late content delivery',
    description: 'Client content may arrive after implementation starts.',
    probability: 'high',
    impact: 'medium',
    mitigationPlan: 'Prepare placeholder copy and confirm deadline.',
    owner: 'Boulos',
    identifiedAtIso: T2,
  });
  const mitigatedRisk = await repo.mitigateProjectRisk('req-1', 'risk-1', {
    mitigatedAtIso: T3,
    mitigationNote: 'Client approved placeholder copy.',
  });
  const risks = await repo.listProjectRisks('req-1');
  const feedback = await repo.createProjectFeedback('req-1', {
    id: 'feedback-1',
    projectRequestId: 'req-1',
    deliverableId: 'deliverable-1',
    author: 'Client',
    sentiment: 'negative',
    message: 'Please make the launch checklist clearer.',
    receivedAtIso: T3,
  });
  const addressedFeedback = await repo.addressProjectFeedback('req-1', 'feedback-1', {
    addressedBy: 'Boulos',
    addressedAtIso: T3,
    responseNote: 'Checklist rewritten with acceptance notes.',
  });
  const feedbackList = await repo.listProjectFeedback('req-1');
  const document = await repo.createProjectDocument('req-1', {
    id: 'document-1',
    projectRequestId: 'req-1',
    deliverableId: 'deliverable-1',
    title: 'Signed launch checklist',
    documentType: 'handoff',
    url: 'https://example.com/projectops/checklist.pdf',
    uploadedBy: 'Boulos',
    uploadedAtIso: T3,
  });
  const archivedDocument = await repo.archiveProjectDocument('req-1', 'document-1', {
    archivedBy: 'Boulos',
    archivedAtIso: T3,
  });
  const documents = await repo.listProjectDocuments('req-1');
  const note = await repo.createProjectNote('req-1', {
    id: 'note-1',
    projectRequestId: 'req-1',
    author: 'Boulos',
    visibility: 'client',
    body: 'Client asked for a clearer launch checklist.',
    createdAtIso: T3,
  });
  const archivedNote = await repo.archiveProjectNote('req-1', 'note-1', {
    archivedBy: 'Boulos',
    archivedAtIso: T3,
  });
  const notes = await repo.listProjectNotes('req-1');
  const task = await repo.createProjectTask('req-1', {
    id: 'task-1',
    projectRequestId: 'req-1',
    title: 'Launch QA checklist',
    description: 'Run the launch checklist before client handoff.',
    assignee: 'Boulos',
    priority: 'high',
    dueAtIso: T3,
    createdAtIso: T2,
  });
  const completedTask = await repo.completeProjectTask('req-1', 'task-1', {
    completedBy: 'Boulos',
    completedAtIso: T3,
  });
  const tasks = await repo.listProjectTasks('req-1');
  const workLog = await repo.createProjectWorkLog('req-1', {
    id: 'work-1',
    projectRequestId: 'req-1',
    taskId: 'task-1',
    actor: 'Boulos',
    minutes: 120,
    billable: true,
    note: 'Completed launch QA checklist.',
    loggedAtIso: T3,
  });
  const workLogs = await repo.listProjectWorkLogs('req-1');
  const expense = await repo.createProjectExpense('req-1', {
    id: 'expense-1',
    projectRequestId: 'req-1',
    category: 'software',
    description: 'Analytics license',
    vendor: 'MetricsCo',
    amountCents: 4500,
    currency: 'USD',
    reimbursable: true,
    receiptUrl: 'https://example.com/projectops/receipt.pdf',
    incurredAtIso: T3,
  });
  const approvedExpense = await repo.approveProjectExpense('req-1', 'expense-1', {
    decidedBy: 'Boulos',
    decidedAtIso: T3,
    decisionNote: 'Approved for launch reporting.',
  });
  const expenses = await repo.listProjectExpenses('req-1');
  const activity = await repo.createProjectActivity('req-1', {
    id: 'activity-1',
    projectRequestId: 'req-1',
    eventType: 'note_added',
    summary: 'Client approved paid invoice and handoff.',
    actor: 'Boulos',
    happenedAtIso: T3,
  });
  const activities = await repo.listProjectActivities('req-1');
  const milestones = await repo.listProjectMilestones('req-1');
  const clients = (await repo.listClients()).items;
  const fetchedClient = await repo.getClient('client-1');
  const requests = (await repo.listProjectRequests()).items;
  const fetchedRequest = await repo.getProjectRequest('req-1');
  const dashboard = await repo.getDashboard();
  const snapshot = sql.snapshot();

  assert.equal(transitioned.status, 'estimated');
  assert.equal(transitioned.estimateAmountCents, 320000);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedBy, 'Boulos');
  assert.equal(milestone.status, 'open');
  assert.equal(completedMilestone.status, 'completed');
  assert.equal(deliverable.status, 'submitted');
  assert.equal(acceptedDeliverable.status, 'accepted');
  assert.equal(deliverables.length, 1);
  assert.equal(deliverables[0]?.acceptedAtIso, T3);
  assert.equal(invoice.status, 'issued');
  assert.equal(paidInvoice.status, 'paid');
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0]?.paidAtIso, T3);
  assert.equal(changeRequest.status, 'proposed');
  assert.equal(approvedChangeRequest.status, 'approved');
  assert.equal(changeRequests.length, 1);
  assert.equal(changeRequests[0]?.decisionNote, 'Approved for launch reporting.');
  assert.equal(issue.status, 'open');
  assert.equal(resolvedIssue.status, 'resolved');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.resolutionNote, 'Assets received.');
  assert.equal(risk.status, 'open');
  assert.equal(mitigatedRisk.status, 'mitigated');
  assert.equal(risks.length, 1);
  assert.equal(risks[0]?.mitigationNote, 'Client approved placeholder copy.');
  assert.equal(feedback.status, 'open');
  assert.equal(addressedFeedback.status, 'addressed');
  assert.equal(feedbackList.length, 1);
  assert.equal(feedbackList[0]?.responseNote, 'Checklist rewritten with acceptance notes.');
  assert.equal(document.status, 'active');
  assert.equal(archivedDocument.status, 'archived');
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.archivedBy, 'Boulos');
  assert.equal(note.status, 'active');
  assert.equal(archivedNote.status, 'archived');
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.archivedBy, 'Boulos');
  assert.equal(task.status, 'open');
  assert.equal(completedTask.status, 'completed');
  assert.equal(completedTask.completedBy, 'Boulos');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.completedAtIso, T3);
  assert.equal(workLog.minutes, 120);
  assert.equal(workLog.billable, true);
  assert.equal(workLogs.length, 1);
  assert.equal(workLogs[0]?.taskId, 'task-1');
  assert.equal(expense.status, 'submitted');
  assert.equal(approvedExpense.status, 'approved');
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0]?.amountCents, 4500);
  assert.equal(activity.eventType, 'note_added');
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.summary, 'Client approved paid invoice and handoff.');
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0]?.completedAtIso, T3);
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.id, 'client-1');
  assert.equal(fetchedClient?.name, 'Zad Studio');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.id, 'req-1');
  assert.equal(fetchedRequest?.status, 'approved');
  assert.equal(fetchedRequest?.estimateCurrency, 'USD');
  assert.equal(snapshot.projectRequests[0]?.status, 'approved');
  assert.equal(snapshot.projectMilestones[0]?.status, 'completed');
  assert.equal(snapshot.projectDeliverables[0]?.status, 'accepted');
  assert.equal(snapshot.projectInvoices[0]?.status, 'paid');
  assert.equal(snapshot.projectChangeRequests[0]?.status, 'approved');
  assert.equal(snapshot.projectIssues[0]?.status, 'resolved');
  assert.equal(snapshot.projectRisks[0]?.status, 'mitigated');
  assert.equal(snapshot.projectFeedback[0]?.status, 'addressed');
  assert.equal(snapshot.projectDocuments[0]?.status, 'archived');
  assert.equal(snapshot.projectNotes[0]?.status, 'archived');
  assert.equal(snapshot.projectTasks[0]?.status, 'completed');
  assert.equal(snapshot.projectWorkLogs[0]?.minutes, 120);
  assert.equal(snapshot.projectExpenses[0]?.status, 'approved');
  assert.equal(snapshot.projectActivities[0]?.summary, 'Client approved paid invoice and handoff.');
  assert.equal(dashboard.totalActiveRequests, 1);
  assert.equal(dashboard.byStatus.approved, 1);
  assert.equal(dashboard.openMilestones, 0);
  assert.equal(dashboard.completedMilestones, 1);
  assert.equal(dashboard.submittedDeliverables, 0);
  assert.equal(dashboard.acceptedDeliverables, 1);
  assert.equal(dashboard.issuedInvoices, 0);
  assert.equal(dashboard.paidInvoices, 1);
  assert.equal(dashboard.financeTotalsByCurrency?.USD.paidInvoiceAmountCents, '320000');
  assert.equal(dashboard.proposedChangeRequests, 0);
  assert.equal(dashboard.approvedChangeRequests, 1);
  assert.equal(dashboard.openIssues, 0);
  assert.equal(dashboard.resolvedIssues, 1);
  assert.equal(dashboard.openRisks, 0);
  assert.equal(dashboard.mitigatedRisks, 1);
  assert.equal(dashboard.openFeedback, 0);
  assert.equal(dashboard.addressedFeedback, 1);
  assert.equal(dashboard.negativeOpenFeedback, 0);
  assert.equal(dashboard.activeDocuments, 0);
  assert.equal(dashboard.archivedDocuments, 1);
  assert.equal(dashboard.activeNotes, 0);
  assert.equal(dashboard.archivedNotes, 1);
  assert.equal(dashboard.clientVisibleNotes, 0);
  assert.equal(dashboard.openTasks, 0);
  assert.equal(dashboard.highOpenTasks, 0);
  assert.equal(dashboard.completedTasks, 1);
  assert.equal(dashboard.workLogs, 1);
  assert.equal(dashboard.billableWorkMinutes, 120);
  assert.equal(dashboard.nonBillableWorkMinutes, 0);
  assert.equal(dashboard.approvedExpenses, 1);
  assert.equal(dashboard.financeTotalsByCurrency?.USD.approvedExpenseAmountCents, '4500');
  assert.equal(dashboard.rows[0]?.clientName, 'Zad Studio');
  assert.equal(dashboard.rows[0]?.estimateAmountCents, 320000);
  assert.equal(dashboard.rows[0]?.completedMilestoneCount, 1);
  assert.equal(dashboard.rows[0]?.acceptedDeliverableCount, 1);
  assert.equal(dashboard.rows[0]?.financeTotalsByCurrency?.USD.paidInvoiceAmountCents, '320000');
  assert.equal(dashboard.rows[0]?.approvedChangeRequestCount, 1);
  assert.equal(dashboard.rows[0]?.resolvedIssueCount, 1);
  assert.equal(dashboard.rows[0]?.mitigatedRiskCount, 1);
  assert.equal(dashboard.rows[0]?.addressedFeedbackCount, 1);
  assert.equal(dashboard.rows[0]?.archivedDocumentCount, 1);
  assert.equal(dashboard.rows[0]?.archivedNoteCount, 1);
  assert.equal(dashboard.rows[0]?.completedTaskCount, 1);
  assert.equal(dashboard.rows[0]?.billableWorkMinutes, 120);
  assert.equal(dashboard.rows[0]?.financeTotalsByCurrency?.USD.approvedExpenseAmountCents, '4500');
  assert.equal(dashboard.rows[0]?.latestActivitySummary, 'Client approved paid invoice and handoff.');
});

unitTest('PROJECTOPS-PERSIST-004: repository maps write conflicts and missing relationships to product errors', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  await applyProjectOpsMigrations(sql);

  const repo = new ProjectOpsRepository(sql);
  await repo.createClient({
    id: 'client-1',
    name: 'Zad Studio',
    createdAtIso: T0,
  });
  await repo.createProjectRequest({
    id: 'req-1',
    clientId: 'client-1',
    title: 'Repository hardening',
    brief: 'Exercise write-side error contracts.',
    createdAtIso: T0,
  });
  await repo.estimateProjectRequest('req-1', {
    amountCents: 150000,
    currency: 'USD',
    estimatedAtIso: T1,
  });
  await repo.approveProjectRequest('req-1', {
    approvedBy: 'Boulos',
    approvedAtIso: T2,
  });

  await assert.rejects(
    () =>
      repo.createClient({
        id: 'client-1',
        name: 'Zad Studio',
        createdAtIso: T0,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'conflict' &&
      error.code === 'PROJECTOPS_CLIENT_ALREADY_EXISTS'
  );

  await assert.rejects(
    () =>
      repo.createProjectInvoice('req-1', {
        id: 'invoice-missing-deliverable',
        projectRequestId: 'req-1',
        deliverableId: 'missing-deliverable',
        invoiceNumber: 'INV-MISSING',
        amountCents: 150000,
        currency: 'USD',
        issuedAtIso: T2,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'not_found' &&
      error.code === 'PROJECTOPS_DELIVERABLE_NOT_FOUND'
  );

  await assert.rejects(
    () =>
      repo.createProjectMilestone('req-missing', {
        id: 'milestone-missing-request',
        projectRequestId: 'req-missing',
        title: 'Missing request',
        createdAtIso: T2,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'not_found' &&
      error.code === 'PROJECTOPS_REQUEST_NOT_FOUND'
  );

  await assert.rejects(
    () =>
      repo.createProjectMilestone('req-1', {
        id: 'milestone-mismatch',
        projectRequestId: 'other-request',
        title: 'Mismatched request',
        createdAtIso: T2,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'invalid_state' &&
      error.code === 'PROJECTOPS_MILESTONE_REQUEST_MISMATCH'
  );

  await assert.rejects(
    () =>
      repo.createProjectDeliverable('req-1', {
        id: 'deliverable-missing-milestone',
        projectRequestId: 'req-1',
        milestoneId: 'missing-milestone',
        title: 'Missing milestone',
        artifactUrl: 'https://example.com/projectops/missing',
        submittedAtIso: T2,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'not_found' &&
      error.code === 'PROJECTOPS_MILESTONE_NOT_FOUND'
  );

  await assert.rejects(
    () =>
      repo.createProjectRequest({
        id: 'req-missing-client',
        clientId: 'missing-client',
        title: 'Missing client',
        brief: 'Should not attach to a missing client.',
        createdAtIso: T0,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'not_found' &&
      error.code === 'PROJECTOPS_CLIENT_NOT_FOUND'
  );

  await assert.rejects(
    () =>
      repo.createProjectRequest({
        id: 'req-1',
        clientId: 'client-1',
        title: 'Duplicate request',
        brief: 'Should not reuse request ids.',
        createdAtIso: T0,
      }),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'conflict' &&
      error.code === 'PROJECTOPS_REQUEST_ALREADY_EXISTS'
  );

  await assert.rejects(
    () => repo.transitionProjectRequest('req-missing', 'estimated', T1),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'not_found' &&
      error.code === 'PROJECTOPS_REQUEST_NOT_FOUND'
  );

  await assert.rejects(
    () => repo.transitionProjectRequest('req-1', 'delivered', T1),
    (error: Error & { code?: string; kind?: string }) =>
      error.name === 'ProjectOpsOperationError' &&
      error.kind === 'invalid_state' &&
      error.code === 'PROJECTOPS_INVALID_STATUS_TRANSITION'
  );
});

unitTest('PROJECTOPS-PERSIST-005: API can run on repository-backed persistence service', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  await applyProjectOpsMigrations(sql);

  const server = await startHttpListener({
    port: 0,
    routes: createProjectOpsRoutes(createProjectOpsRepositoryService(sql), () => T0),
  });

  try {
    await expectOkJson(`${server.origin}/projectops/clients`, {
      id: 'client-1',
      name: 'Zad Studio',
    });

    const request = await expectOkJson<ProjectRequest>(
      `${server.origin}/projectops/project-requests`,
      {
        id: 'req-1',
        clientId: 'client-1',
        title: 'Repository-backed API',
        brief: 'Create through API and persist through SQL executor.',
        priority: 'high',
      }
    );
    assert.equal(request.status, 'new');

    const transitioned = await expectOkJson<ProjectRequest>(
      `${server.origin}/projectops/project-requests/req-1/estimate`,
      { amountCents: 240000, currency: 'USD', estimatedAtIso: T1 }
    );
    assert.equal(transitioned.status, 'estimated');
    assert.equal(transitioned.estimateAmountCents, 240000);

    const approved = await expectOkJson<ProjectRequest>(
      `${server.origin}/projectops/project-requests/req-1/approve`,
      { approvedBy: 'Boulos', approvedAtIso: T2 }
    );
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvedBy, 'Boulos');

    const milestone = await expectOkJson<ProjectMilestone>(
      `${server.origin}/projectops/project-requests/req-1/milestones`,
      {
        id: 'milestone-1',
        title: 'Prepare handoff',
        dueAtIso: T3,
        createdAtIso: T2,
      }
    );
    assert.equal(milestone.status, 'open');

    const milestonesRes = await fetch(`${server.origin}/projectops/project-requests/req-1/milestones`);
    assert.equal(milestonesRes.status, 200);
    const milestones = await milestonesRes.json() as readonly ProjectMilestone[];
    assert.equal(milestones.length, 1);

    const completedMilestone = await expectOkJson<ProjectMilestone>(
      `${server.origin}/projectops/project-requests/req-1/milestones/milestone-1/complete`,
      { completedAtIso: T3 }
    );
    assert.equal(completedMilestone.status, 'completed');

    const deliverable = await expectOkJson<ProjectDeliverable>(
      `${server.origin}/projectops/project-requests/req-1/deliverables`,
      {
        id: 'deliverable-1',
        milestoneId: 'milestone-1',
        title: 'Client handoff',
        artifactUrl: 'https://example.com/projectops/client-handoff',
        submittedAtIso: T3,
      }
    );
    assert.equal(deliverable.status, 'submitted');

    const deliverablesRes = await fetch(`${server.origin}/projectops/project-requests/req-1/deliverables`);
    assert.equal(deliverablesRes.status, 200);
    const deliverables = await deliverablesRes.json() as readonly ProjectDeliverable[];
    assert.equal(deliverables.length, 1);

    const acceptedDeliverable = await expectOkJson<ProjectDeliverable>(
      `${server.origin}/projectops/project-requests/req-1/deliverables/deliverable-1/accept`,
      { acceptedAtIso: T3 }
    );
    assert.equal(acceptedDeliverable.status, 'accepted');

    const invoice = await expectOkJson<ProjectInvoice>(
      `${server.origin}/projectops/project-requests/req-1/invoices`,
      {
        id: 'invoice-1',
        deliverableId: 'deliverable-1',
        invoiceNumber: 'INV-001',
        amountCents: 240000,
        currency: 'USD',
        issuedAtIso: T3,
      }
    );
    assert.equal(invoice.status, 'issued');

    const invoicesRes = await fetch(`${server.origin}/projectops/project-requests/req-1/invoices`);
    assert.equal(invoicesRes.status, 200);
    const invoices = await invoicesRes.json() as readonly ProjectInvoice[];
    assert.equal(invoices.length, 1);

    const paidInvoice = await expectOkJson<ProjectInvoice>(
      `${server.origin}/projectops/project-requests/req-1/invoices/invoice-1/pay`,
      { paidAtIso: T3 }
    );
    assert.equal(paidInvoice.status, 'paid');

    const feedback = await expectOkJson<ProjectFeedback>(
      `${server.origin}/projectops/project-requests/req-1/feedback`,
      {
        id: 'feedback-1',
        deliverableId: 'deliverable-1',
        author: 'Client',
        sentiment: 'negative',
        message: 'Please make acceptance notes easier to scan.',
        receivedAtIso: T3,
      }
    );
    assert.equal(feedback.status, 'open');

    const feedbackRes = await fetch(`${server.origin}/projectops/project-requests/req-1/feedback`);
    assert.equal(feedbackRes.status, 200);
    const feedbackList = await feedbackRes.json() as readonly ProjectFeedback[];
    assert.equal(feedbackList.length, 1);

    const addressedFeedback = await expectOkJson<ProjectFeedback>(
      `${server.origin}/projectops/project-requests/req-1/feedback/feedback-1/address`,
      {
        addressedBy: 'Boulos',
        addressedAtIso: T3,
        responseNote: 'Acceptance notes rewritten for the client.',
      }
    );
    assert.equal(addressedFeedback.status, 'addressed');

    const document = await expectOkJson<ProjectDocument>(
      `${server.origin}/projectops/project-requests/req-1/documents`,
      {
        id: 'document-1',
        deliverableId: 'deliverable-1',
        title: 'Signed launch checklist',
        documentType: 'handoff',
        url: 'https://example.com/projectops/checklist.pdf',
        uploadedBy: 'Boulos',
        uploadedAtIso: T3,
      }
    );
    assert.equal(document.status, 'active');

    const documentsRes = await fetch(`${server.origin}/projectops/project-requests/req-1/documents`);
    assert.equal(documentsRes.status, 200);
    const documents = await documentsRes.json() as readonly ProjectDocument[];
    assert.equal(documents.length, 1);

    const archivedDocument = await expectOkJson<ProjectDocument>(
      `${server.origin}/projectops/project-requests/req-1/documents/document-1/archive`,
      { archivedBy: 'Boulos', archivedAtIso: T3 }
    );
    assert.equal(archivedDocument.status, 'archived');

    const note = await expectOkJson<ProjectNote>(
      `${server.origin}/projectops/project-requests/req-1/notes`,
      {
        id: 'note-1',
        author: 'Boulos',
        visibility: 'client',
        body: 'Client asked for a clearer launch checklist.',
        createdAtIso: T3,
      }
    );
    assert.equal(note.status, 'active');

    const notesRes = await fetch(`${server.origin}/projectops/project-requests/req-1/notes`);
    assert.equal(notesRes.status, 200);
    const notes = await notesRes.json() as readonly ProjectNote[];
    assert.equal(notes.length, 1);

    const archivedNote = await expectOkJson<ProjectNote>(
      `${server.origin}/projectops/project-requests/req-1/notes/note-1/archive`,
      { archivedBy: 'Boulos', archivedAtIso: T3 }
    );
    assert.equal(archivedNote.status, 'archived');

    const task = await expectOkJson<ProjectTask>(
      `${server.origin}/projectops/project-requests/req-1/tasks`,
      {
        id: 'task-1',
        title: 'Launch QA checklist',
        description: 'Run the launch checklist before client handoff.',
        assignee: 'Boulos',
        priority: 'high',
        dueAtIso: T3,
        createdAtIso: T2,
      }
    );
    assert.equal(task.status, 'open');
    assert.equal(task.priority, 'high');

    const tasksRes = await fetch(`${server.origin}/projectops/project-requests/req-1/tasks`);
    assert.equal(tasksRes.status, 200);
    const tasks = await tasksRes.json() as readonly ProjectTask[];
    assert.equal(tasks.length, 1);

    const completedTask = await expectOkJson<ProjectTask>(
      `${server.origin}/projectops/project-requests/req-1/tasks/task-1/complete`,
      { completedBy: 'Boulos', completedAtIso: T3 }
    );
    assert.equal(completedTask.status, 'completed');

    const workLog = await expectOkJson<ProjectWorkLog>(
      `${server.origin}/projectops/project-requests/req-1/work-logs`,
      {
        id: 'work-1',
        taskId: 'task-1',
        actor: 'Boulos',
        minutes: 120,
        billable: true,
        note: 'Completed launch QA checklist.',
        loggedAtIso: T3,
      }
    );
    assert.equal(workLog.minutes, 120);
    assert.equal(workLog.billable, true);

    const workLogsRes = await fetch(`${server.origin}/projectops/project-requests/req-1/work-logs`);
    assert.equal(workLogsRes.status, 200);
    const workLogs = await workLogsRes.json() as readonly ProjectWorkLog[];
    assert.equal(workLogs.length, 1);

    const expense = await expectOkJson<ProjectExpense>(
      `${server.origin}/projectops/project-requests/req-1/expenses`,
      {
        id: 'expense-1',
        category: 'software',
        description: 'Analytics license',
        vendor: 'MetricsCo',
        amountCents: 4500,
        currency: 'USD',
        reimbursable: true,
        receiptUrl: 'https://example.com/projectops/receipt.pdf',
        incurredAtIso: T3,
      }
    );
    assert.equal(expense.status, 'submitted');

    const expensesRes = await fetch(`${server.origin}/projectops/project-requests/req-1/expenses`);
    assert.equal(expensesRes.status, 200);
    const expenses = await expensesRes.json() as readonly ProjectExpense[];
    assert.equal(expenses.length, 1);

    const approvedExpense = await expectOkJson<ProjectExpense>(
      `${server.origin}/projectops/project-requests/req-1/expenses/expense-1/approve`,
      {
        decidedBy: 'Boulos',
        decidedAtIso: T3,
        decisionNote: 'Approved for launch reporting.',
      }
    );
    assert.equal(approvedExpense.status, 'approved');

    const risk = await expectOkJson<ProjectRisk>(
      `${server.origin}/projectops/project-requests/req-1/risks`,
      {
        id: 'risk-1',
        title: 'Late content delivery',
        description: 'Client content may arrive after implementation starts.',
        probability: 'high',
        impact: 'medium',
        mitigationPlan: 'Prepare placeholder copy and confirm deadline.',
        owner: 'Boulos',
        identifiedAtIso: T2,
      }
    );
    assert.equal(risk.status, 'open');

    const risksRes = await fetch(`${server.origin}/projectops/project-requests/req-1/risks`);
    assert.equal(risksRes.status, 200);
    const risks = await risksRes.json() as readonly ProjectRisk[];
    assert.equal(risks.length, 1);

    const mitigatedRisk = await expectOkJson<ProjectRisk>(
      `${server.origin}/projectops/project-requests/req-1/risks/risk-1/mitigate`,
      {
        mitigatedAtIso: T3,
        mitigationNote: 'Client approved placeholder copy.',
      }
    );
    assert.equal(mitigatedRisk.status, 'mitigated');

    const clientsRes = await fetch(`${server.origin}/projectops/clients`);
    assert.equal(clientsRes.status, 200);
    const clients = (await clientsRes.json() as { items: readonly { id: string }[] }).items;
    assert.equal(clients[0]?.id, 'client-1');

    const clientRes = await fetch(`${server.origin}/projectops/clients/client-1`);
    assert.equal(clientRes.status, 200);
    assert.equal(((await clientRes.json()) as { name: string }).name, 'Zad Studio');

    const requestsRes = await fetch(`${server.origin}/projectops/project-requests`);
    assert.equal(requestsRes.status, 200);
    const requests = (await requestsRes.json() as { items: readonly { id: string }[] }).items;
    assert.equal(requests[0]?.id, 'req-1');

    const requestRes = await fetch(`${server.origin}/projectops/project-requests/req-1`);
    assert.equal(requestRes.status, 200);
    const fetchedRequest = await requestRes.json() as { status: string; approvedBy?: string };
    assert.equal(fetchedRequest.status, 'approved');
    assert.equal(fetchedRequest.approvedBy, 'Boulos');

    const missingRes = await fetch(`${server.origin}/projectops/project-requests/missing`);
    assert.equal(missingRes.status, 404);
    assert.equal(((await missingRes.json()) as { code: string }).code, 'PROJECTOPS_REQUEST_NOT_FOUND');

    const dashboardRes = await fetch(`${server.origin}/projectops/dashboard`);
    assert.equal(dashboardRes.status, 200);
    const dashboard = await dashboardRes.json() as ProjectOpsDashboardView;

    assert.equal(dashboard.totalActiveRequests, 1);
    assert.equal(dashboard.byStatus.approved, 1);
    assert.equal(dashboard.completedMilestones, 1);
    assert.equal(dashboard.acceptedDeliverables, 1);
    assert.equal(dashboard.paidInvoices, 1);
    assert.equal(dashboard.financeTotalsByCurrency?.USD.paidInvoiceAmountCents, '240000');
    assert.equal(dashboard.addressedFeedback, 1);
    assert.equal(dashboard.archivedDocuments, 1);
    assert.equal(dashboard.archivedNotes, 1);
    assert.equal(dashboard.completedTasks, 1);
    assert.equal(dashboard.workLogs, 1);
    assert.equal(dashboard.billableWorkMinutes, 120);
    assert.equal(dashboard.approvedExpenses, 1);
    assert.equal(dashboard.financeTotalsByCurrency?.USD.approvedExpenseAmountCents, '4500');
    assert.equal(dashboard.mitigatedRisks, 1);
    assert.equal(sql.snapshot().projectRequests[0]?.status, 'approved');
    assert.equal(sql.snapshot().projectMilestones[0]?.status, 'completed');
    assert.equal(sql.snapshot().projectDeliverables[0]?.status, 'accepted');
    assert.equal(sql.snapshot().projectInvoices[0]?.status, 'paid');
    assert.equal(sql.snapshot().projectFeedback[0]?.status, 'addressed');
    assert.equal(sql.snapshot().projectDocuments[0]?.status, 'archived');
    assert.equal(sql.snapshot().projectNotes[0]?.status, 'archived');
    assert.equal(sql.snapshot().projectTasks[0]?.status, 'completed');
    assert.equal(sql.snapshot().projectWorkLogs[0]?.minutes, 120);
    assert.equal(sql.snapshot().projectExpenses[0]?.status, 'approved');
    assert.equal(sql.snapshot().projectRisks[0]?.status, 'mitigated');
  } finally {
    await server.close();
  }
});

unitTest('PROJECTOPS-PERSIST-006: API exposes stable write-side error contracts', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  await applyProjectOpsMigrations(sql);

  const server = await startHttpListener({
    port: 0,
    routes: createProjectOpsRoutes(createProjectOpsRepositoryService(sql), () => T0),
  });

  try {
    await expectOkJson(`${server.origin}/projectops/clients`, {
      id: 'client-1',
      name: 'Zad Studio',
    });
    await expectOkJson(`${server.origin}/projectops/project-requests`, {
      id: 'req-1',
      clientId: 'client-1',
      title: 'Stable errors',
      brief: 'Errors are part of the contract.',
    });

    await expectProjectOpsError(`${server.origin}/projectops/clients`, {
      id: 'client-1',
      name: 'Zad Studio',
    }, 409, 'PROJECTOPS_CLIENT_ALREADY_EXISTS');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests`, {
      id: 'req-missing-client',
      clientId: 'missing-client',
      title: 'Missing client',
      brief: 'This should return a resource error.',
    }, 404, 'PROJECTOPS_CLIENT_NOT_FOUND');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests`, {
      id: 'req-1',
      clientId: 'client-1',
      title: 'Duplicate request',
      brief: 'This should return a conflict.',
    }, 409, 'PROJECTOPS_REQUEST_ALREADY_EXISTS');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests/req-1/status`, {
      status: 'delivered',
    }, 400, 'PROJECTOPS_INVALID_STATUS_TRANSITION');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests/req-1/approve`, {
      approvedBy: 'Boulos',
    }, 400, 'PROJECTOPS_ESTIMATE_REQUIRED');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests/req-1/milestones`, {
      id: 'milestone-not-ready',
      title: 'Not ready',
    }, 400, 'PROJECTOPS_REQUEST_NOT_READY_FOR_MILESTONES');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests/req-1/deliverables`, {
      id: 'deliverable-not-ready',
      title: 'Too early',
      artifactUrl: 'https://example.com/projectops/too-early',
    }, 409, 'PROJECTOPS_REQUEST_NOT_READY_FOR_DELIVERABLES');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests/req-1/invoices`, {
      id: 'invoice-not-ready',
      invoiceNumber: 'INV-NOT-READY',
      amountCents: 100000,
      currency: 'USD',
    }, 409, 'PROJECTOPS_FINANCE_STATE_CONFLICT');
  } finally {
    await server.close();
  }
});

async function expectOkJson<T = unknown>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 200);
  return await response.json() as T;
}

async function expectProjectOpsError(
  url: string,
  body: Record<string, unknown>,
  status: number,
  code: string
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { code: string; status: number; message: string };

  assert.equal(response.status, status);
  assert.equal(payload.status, status);
  assert.equal(payload.code, code);
  assert.equal(typeof payload.message, 'string');
}
