import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  ProjectOpsRepository,
  acceptProjectDeliverable,
  addressProjectFeedback,
  archiveProjectDocument,
  archiveProjectNote,
  approveProjectRequest,
  approveProjectExpense,
  approveProjectChangeRequest,
  completeProjectTask,
  composeProjectOpsDashboard,
  createClient,
  createProjectChangeRequest,
  createProjectDeliverable,
  createProjectDocument,
  createProjectExpense,
  createProjectFeedback,
  createProjectInvoice,
  createProjectIssue,
  createProjectMilestone,
  createProjectNote,
  createProjectRequest,
  createProjectRisk,
  createProjectTask,
  createProjectWorkLog,
  estimateProjectRequest,
  markProjectInvoicePaid,
  mitigateProjectRisk,
  rejectProjectChangeRequest,
  rejectProjectExpense,
  resolveProjectIssue,
  completeProjectMilestone,
  createProjectActivity,
  insertClientSql,
  insertProjectRequestSql,
  projectOpsSchemaSql,
  transitionProjectRequest,
  type AddressProjectFeedbackInput,
  type ArchiveProjectDocumentInput,
  type ArchiveProjectNoteInput,
  type ApproveProjectRequestInput,
  type CompleteProjectTaskInput,
  type DecideProjectExpenseInput,
  type DecideProjectChangeRequestInput,
  type EstimateProjectRequestInput,
  type NewProjectActivityInput,
  type NewProjectChangeRequestInput,
  type NewProjectDeliverableInput,
  type NewProjectDocumentInput,
  type NewProjectExpenseInput,
  type NewProjectFeedbackInput,
  type NewProjectInvoiceInput,
  type NewProjectIssueInput,
  type NewClientInput,
  type NewProjectMilestoneInput,
  type NewProjectNoteInput,
  type NewProjectRequestInput,
  type NewProjectRiskInput,
  type NewProjectTaskInput,
  type NewProjectWorkLogInput,
  type ProjectDeliverable,
  type ProjectActivity,
  type ProjectChangeRequest,
  type ProjectDocument,
  type ProjectExpense,
  type ProjectFeedback,
  type ProjectInvoice,
  type ProjectIssue,
  type ProjectOpsClient,
  type ProjectOpsDashboardView,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectRequest,
  type ProjectRequestStatus,
  type ProjectRisk,
  type ProjectTask,
  type ProjectWorkLog,
  type ResolveProjectIssueInput,
  type MitigateProjectRiskInput,
  type SqlStatement,
} from '../packages/projectops/src/index.ts';
import { createProjectOpsRoutes, type ProjectOpsApiService } from '../apps/api/src/projectops/routes.ts';
import { startHttpListener } from '../apps/api/src/bootstrap/http-listener.ts';
import { composeProjectOpsDashboardPage } from '../apps/web/src/projectops/dashboard-view.ts';

const T0 = '2026-09-29T08:00:00.000Z';
const T1 = '2026-09-29T09:00:00.000Z';
const T2 = '2026-09-29T10:00:00.000Z';
const T3 = '2026-09-29T11:00:00.000Z';

unitTest('PROJECTOPS-001: client to project request workflow enforces legal vertical slice states', () => {
  const client = createClient({
    id: 'client-1',
    name: 'Zad Studio',
    contactName: 'Boulos',
    email: 'hello@example.com',
    createdAtIso: T0,
  });
  const request = createProjectRequest({
    id: 'req-1',
    clientId: client.id,
    title: 'Landing page rebuild',
    brief: 'Replace slow static site with a clean delivery page.',
    priority: 'high',
    createdAtIso: T0,
  });

  assert.equal(client.status, 'active');
  assert.equal(request.status, 'new');

  assert.throws(() => transitionProjectRequest(request, 'estimated', T1), /Use the estimate/);
  const estimated = estimateProjectRequest(request, { amountCents: 10000, currency: 'USD', estimatedAtIso: T1 });
  assert.equal(estimated.status, 'estimated');
  assert.equal(estimated.updatedAtIso, T1);

  const estimatedWithValue = estimateProjectRequest(request, {
    amountCents: 250000,
    currency: 'usd',
    estimatedAtIso: T1,
  });
  assert.equal(estimatedWithValue.status, 'estimated');
  assert.equal(estimatedWithValue.estimateAmountCents, 250000);
  assert.equal(estimatedWithValue.estimateCurrency, 'USD');

  const approved = approveProjectRequest(estimatedWithValue, {
    approvedBy: 'Boulos',
    approvedAtIso: T2,
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedBy, 'Boulos');

  const milestone = createProjectMilestone(approved, {
    id: 'milestone-1',
    projectRequestId: request.id,
    title: 'Deliver first draft',
    dueAtIso: T3,
    createdAtIso: T2,
  });
  assert.equal(milestone.status, 'open');
  assert.equal(milestone.projectRequestId, request.id);

  const completedMilestone = completeProjectMilestone(milestone, T3);
  assert.equal(completedMilestone.status, 'completed');
  assert.equal(completedMilestone.completedAtIso, T3);

  const deliverable = createProjectDeliverable(approved, {
    id: 'deliverable-1',
    projectRequestId: request.id,
    milestoneId: milestone.id,
    title: 'First draft package',
    artifactUrl: 'https://example.com/projectops/first-draft',
    submittedAtIso: T3,
  });
  assert.equal(deliverable.status, 'submitted');
  assert.equal(deliverable.milestoneId, milestone.id);

  const acceptedDeliverable = acceptProjectDeliverable(deliverable, T3);
  assert.equal(acceptedDeliverable.status, 'accepted');
  assert.equal(acceptedDeliverable.acceptedAtIso, T3);

  const invoice = createProjectInvoice(approved, {
    id: 'invoice-1',
    projectRequestId: request.id,
    deliverableId: deliverable.id,
    invoiceNumber: 'INV-001',
    amountCents: 250000,
    currency: 'usd',
    issuedAtIso: T3,
  });
  assert.equal(invoice.status, 'issued');
  assert.equal(invoice.currency, 'USD');

  const paidInvoice = markProjectInvoicePaid(invoice, T3);
  assert.equal(paidInvoice.status, 'paid');
  assert.equal(paidInvoice.paidAtIso, T3);

  const changeRequest = createProjectChangeRequest(approved, {
    id: 'change-1',
    projectRequestId: request.id,
    title: 'Add CMS editing',
    description: 'Client wants editable launch copy.',
    requestedBy: 'Boulos',
    estimateDeltaCents: 75000,
    estimateCurrency: 'usd',
    requestedAtIso: T3,
  });
  assert.equal(changeRequest.status, 'proposed');
  assert.equal(changeRequest.estimateCurrency, 'USD');

  const approvedChange = approveProjectChangeRequest(changeRequest, {
    decidedBy: 'Client',
    decidedAtIso: T3,
    decisionNote: 'Approved for launch scope.',
  });
  assert.equal(approvedChange.status, 'approved');
  assert.equal(approvedChange.decidedBy, 'Client');

  const issue = createProjectIssue(approved, {
    id: 'issue-1',
    projectRequestId: request.id,
    title: 'Waiting on hero assets',
    description: 'Client needs to send final hero images before handoff.',
    severity: 'high',
    owner: 'Client',
    openedAtIso: T3,
  });
  assert.equal(issue.status, 'open');
  assert.equal(issue.severity, 'high');

  const resolvedIssue = resolveProjectIssue(issue, {
    resolvedAtIso: T3,
    resolutionNote: 'Assets received.',
  });
  assert.equal(resolvedIssue.status, 'resolved');
  assert.equal(resolvedIssue.resolutionNote, 'Assets received.');

  const feedback = createProjectFeedback(approved, {
    id: 'feedback-1',
    projectRequestId: request.id,
    deliverableId: deliverable.id,
    author: 'Client',
    sentiment: 'negative',
    message: 'The first draft needs clearer hero copy.',
    receivedAtIso: T3,
  });
  assert.equal(feedback.status, 'open');
  assert.equal(feedback.sentiment, 'negative');

  const addressedFeedback = addressProjectFeedback(feedback, {
    addressedBy: 'Boulos',
    addressedAtIso: T3,
    responseNote: 'Hero copy revised in the handoff package.',
  });
  assert.equal(addressedFeedback.status, 'addressed');
  assert.equal(addressedFeedback.responseNote, 'Hero copy revised in the handoff package.');

  const document = createProjectDocument(approved, {
    id: 'document-1',
    projectRequestId: request.id,
    deliverableId: deliverable.id,
    title: 'Signed launch checklist',
    documentType: 'handoff',
    url: 'https://example.com/projectops/checklist.pdf',
    uploadedBy: 'Boulos',
    uploadedAtIso: T3,
  });
  assert.equal(document.status, 'active');
  assert.equal(document.documentType, 'handoff');

  const archivedDocument = archiveProjectDocument(document, {
    archivedBy: 'Boulos',
    archivedAtIso: T3,
  });
  assert.equal(archivedDocument.status, 'archived');
  assert.equal(archivedDocument.archivedBy, 'Boulos');

  const note = createProjectNote(approved, {
    id: 'note-1',
    projectRequestId: request.id,
    author: 'Boulos',
    visibility: 'client',
    body: 'Client asked for a clearer launch checklist.',
    createdAtIso: T3,
  });
  assert.equal(note.status, 'active');
  assert.equal(note.visibility, 'client');

  const archivedNote = archiveProjectNote(note, {
    archivedBy: 'Boulos',
    archivedAtIso: T3,
  });
  assert.equal(archivedNote.status, 'archived');
  assert.equal(archivedNote.archivedBy, 'Boulos');

  const task = createProjectTask(approved, {
    id: 'task-1',
    projectRequestId: request.id,
    title: 'Launch QA checklist',
    description: 'Run the launch checklist before client handoff.',
    assignee: 'Boulos',
    priority: 'high',
    dueAtIso: T3,
    createdAtIso: T2,
  });
  assert.equal(task.status, 'open');
  assert.equal(task.priority, 'high');

  const completedTask = completeProjectTask(task, {
    completedBy: 'Boulos',
    completedAtIso: T3,
  });
  assert.equal(completedTask.status, 'completed');
  assert.equal(completedTask.completedBy, 'Boulos');

  const workLog = createProjectWorkLog(approved, {
    id: 'work-1',
    projectRequestId: request.id,
    taskId: task.id,
    actor: 'Boulos',
    minutes: 120,
    billable: true,
    note: 'Completed launch QA checklist.',
    loggedAtIso: T3,
  });
  assert.equal(workLog.minutes, 120);
  assert.equal(workLog.billable, true);
  assert.equal(workLog.taskId, task.id);

  const expense = createProjectExpense(approved, {
    id: 'expense-1',
    projectRequestId: request.id,
    category: 'software',
    description: 'Analytics license',
    vendor: 'MetricsCo',
    amountCents: 4500,
    currency: 'usd',
    reimbursable: true,
    receiptUrl: 'https://example.com/projectops/receipt.pdf',
    incurredAtIso: T3,
  });
  assert.equal(expense.status, 'submitted');
  assert.equal(expense.currency, 'USD');

  const approvedExpense = approveProjectExpense(expense, {
    decidedBy: 'Boulos',
    decidedAtIso: T3,
    decisionNote: 'Approved for launch reporting.',
  });
  assert.equal(approvedExpense.status, 'approved');

  const rejectedExpense = rejectProjectExpense({
    ...expense,
    id: 'expense-2',
  }, {
    decidedBy: 'Boulos',
    decidedAtIso: T3,
    decisionNote: 'Duplicate receipt.',
  });
  assert.equal(rejectedExpense.status, 'rejected');

  const risk = createProjectRisk(approved, {
    id: 'risk-1',
    projectRequestId: request.id,
    title: 'Late content delivery',
    description: 'Client content may arrive after implementation starts.',
    probability: 'high',
    impact: 'medium',
    mitigationPlan: 'Prepare placeholder copy and confirm deadline.',
    owner: 'Boulos',
    identifiedAtIso: T2,
  });
  assert.equal(risk.status, 'open');
  assert.equal(risk.probability, 'high');

  const mitigatedRisk = mitigateProjectRisk(risk, {
    mitigatedAtIso: T3,
    mitigationNote: 'Client approved placeholder copy.',
  });
  assert.equal(mitigatedRisk.status, 'mitigated');
  assert.equal(mitigatedRisk.mitigationNote, 'Client approved placeholder copy.');

  assert.throws(
    () => transitionProjectRequest(estimated, 'delivered', T1),
    /Illegal project request transition/
  );
});

unitTest('PROJECTOPS-002: raw SQL contracts are parameterized and describe the first schema slice', () => {
  const client = createClient({
    id: 'client-1',
    name: 'Zad Studio',
    createdAtIso: T0,
  });
  const request = createProjectRequest({
    id: 'req-1',
    clientId: client.id,
    title: 'Operations dashboard',
    brief: 'Show active project work.',
    budgetRange: '$1,000-$2,000',
    priority: 'medium',
    createdAtIso: T0,
  });

  const clientInsert = insertClientSql(client);
  const requestInsert = insertProjectRequestSql(request);

  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_clients/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_requests/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_deliverables/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_invoices/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_change_requests/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_issues/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_risks/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_feedback/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_documents/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_notes/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_tasks/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_work_logs/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_expenses/);
  assert.match(projectOpsSchemaSql.join('\n'), /CREATE TABLE IF NOT EXISTS projectops_project_activities/);
  assert.match(clientInsert.sql, /\$1/);
  assert.match(requestInsert.sql, /\$15/);
  assert.equal(clientInsert.sql.includes('Zad Studio'), false);
  assert.equal(requestInsert.sql.includes('Operations dashboard'), false);
  assert.deepEqual(clientInsert.params.slice(0, 2), ['client-1', 'Zad Studio']);
  assert.deepEqual(requestInsert.params.slice(0, 4), [
    'req-1',
    'client-1',
    'Operations dashboard',
    'Show active project work.',
  ]);
});

unitTest('PROJECTOPS-003: repository composes raw SQL executor calls into a dashboard view', async () => {
  const executed: SqlStatement[] = [];
  const current = createProjectRequest({
    id: 'req-1',
    clientId: 'client-1',
    title: 'ProjectOps slice',
    brief: 'Prove the foundation with a product workflow.',
    priority: 'high',
    createdAtIso: T0,
  });

  const repo = new ProjectOpsRepository({
    async query<T>(statement: SqlStatement): Promise<readonly T[]> {
      executed.push(statement);
      if (statement.sql.startsWith('UPDATE projectops_project_requests')) {
        return [{ ...current, status: 'estimated', updatedAtIso: T1 } as T];
      }
      if (statement.sql.includes('WHERE id = $1')) return [current as T];
      if (statement.sql.includes('FROM projectops_project_requests pr')) {
        return [
          {
            id: 'req-1',
            clientId: 'client-1',
            clientName: 'Zad Studio',
            title: 'ProjectOps slice',
            priority: 'high',
            status: 'estimated',
            updatedAtIso: T1,
          } as T,
        ];
      }
      return [];
    },
  });

  const transitioned = await repo.estimateProjectRequest('req-1', { amountCents: 10000, currency: 'USD', estimatedAtIso: T1 });
  const dashboard = await repo.getDashboard();

  assert.equal(transitioned.status, 'estimated');
  assert.equal(dashboard.totalActiveRequests, 1);
  assert.equal(dashboard.highPriorityOpen, 1);
  assert.equal(executed.length, 3);
  assert.deepEqual(executed[0].params, ['req-1']);
  assert.deepEqual(executed[1].params, ['req-1', 10000, 'USD', T1, 'estimated', T1, 1, 'new']);
});

unitTest('PROJECTOPS-004: API route slice creates client, creates request, transitions status, and reads dashboard', async () => {
  const service = createMemoryProjectOpsService();
  const server = await startHttpListener({
    port: 0,
    routes: createProjectOpsRoutes(service, () => T0),
  });

  try {
    const clientRes = await fetch(`${server.origin}/projectops/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'client-1', name: 'Zad Studio' }),
    });
    assert.equal(clientRes.status, 200);
    assert.equal((await clientRes.json() as ProjectOpsClient).id, 'client-1');

    const requestRes = await fetch(`${server.origin}/projectops/project-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'req-1',
        clientId: 'client-1',
        title: 'ProjectOps dashboard',
        brief: 'Show work moving through delivery.',
        priority: 'high',
      }),
    });
    assert.equal(requestRes.status, 200);
    assert.equal((await requestRes.json() as ProjectRequest).status, 'new');

    const transitionRes = await fetch(`${server.origin}/projectops/project-requests/req-1/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'estimated' }),
    });
    assert.equal(transitionRes.status, 400);
    assert.equal((await transitionRes.json()).code, 'PROJECTOPS_EXPLICIT_COMMAND_REQUIRED');

    const estimateRes = await fetch(`${server.origin}/projectops/project-requests/req-1/estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountCents: 180000, currency: 'USD', estimatedAtIso: T1 }),
    });
    assert.equal(estimateRes.status, 200);

    const request2Res = await fetch(`${server.origin}/projectops/project-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'req-2',
        clientId: 'client-1',
        title: 'Estimate command',
        brief: 'Show explicit estimate and approval commands.',
      }),
    });
    assert.equal(request2Res.status, 200);

    const estimate2Res = await fetch(`${server.origin}/projectops/project-requests/req-2/estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountCents: 180000, currency: 'USD', estimatedAtIso: T1 }),
    });
    const estimated2 = await estimate2Res.json() as ProjectRequest;
    assert.equal(estimate2Res.status, 200);
    assert.equal(estimated2.status, 'estimated');
    assert.equal(estimated2.estimateAmountCents, 180000);

    const approve2Res = await fetch(`${server.origin}/projectops/project-requests/req-2/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'Boulos', approvedAtIso: T2 }),
    });
    const approved2 = await approve2Res.json() as ProjectRequest;
    assert.equal(approve2Res.status, 200);
    assert.equal(approved2.status, 'approved');
    assert.equal(approved2.approvedBy, 'Boulos');

    const milestoneRes = await fetch(`${server.origin}/projectops/project-requests/req-2/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'milestone-1',
        title: 'Prepare handoff',
        dueAtIso: T3,
        createdAtIso: T2,
      }),
    });
    const milestone = await milestoneRes.json() as ProjectMilestone;
    assert.equal(milestoneRes.status, 200);
    assert.equal(milestone.status, 'open');

    const milestonesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/milestones`);
    assert.equal(milestonesRes.status, 200);
    const milestones = await milestonesRes.json() as readonly ProjectMilestone[];
    assert.equal(milestones.length, 1);

    const completeMilestoneRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/milestones/milestone-1/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completedAtIso: T3 }),
      }
    );
    const completedMilestone = await completeMilestoneRes.json() as ProjectMilestone;
    assert.equal(completeMilestoneRes.status, 200);
    assert.equal(completedMilestone.status, 'completed');

    const deliverableRes = await fetch(`${server.origin}/projectops/project-requests/req-2/deliverables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'deliverable-1',
        milestoneId: 'milestone-1',
        title: 'Handoff package',
        artifactUrl: 'https://example.com/projectops/handoff',
        submittedAtIso: T3,
      }),
    });
    const deliverable = await deliverableRes.json() as ProjectDeliverable;
    assert.equal(deliverableRes.status, 200);
    assert.equal(deliverable.status, 'submitted');

    const deliverablesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/deliverables`);
    assert.equal(deliverablesRes.status, 200);
    const deliverables = await deliverablesRes.json() as readonly ProjectDeliverable[];
    assert.equal(deliverables.length, 1);

    const acceptDeliverableRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/deliverables/deliverable-1/accept`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acceptedAtIso: T3 }),
      }
    );
    const acceptedDeliverable = await acceptDeliverableRes.json() as ProjectDeliverable;
    assert.equal(acceptDeliverableRes.status, 200);
    assert.equal(acceptedDeliverable.status, 'accepted');

    const invoiceRes = await fetch(`${server.origin}/projectops/project-requests/req-2/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'invoice-1',
        deliverableId: 'deliverable-1',
        invoiceNumber: 'INV-001',
        amountCents: 180000,
        currency: 'USD',
        issuedAtIso: T3,
      }),
    });
    const invoice = await invoiceRes.json() as ProjectInvoice;
    assert.equal(invoiceRes.status, 200);
    assert.equal(invoice.status, 'issued');

    const invoicesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/invoices`);
    assert.equal(invoicesRes.status, 200);
    const invoices = await invoicesRes.json() as readonly ProjectInvoice[];
    assert.equal(invoices.length, 1);

    const payInvoiceRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/invoices/invoice-1/pay`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paidAtIso: T3 }),
      }
    );
    const paidInvoice = await payInvoiceRes.json() as ProjectInvoice;
    assert.equal(payInvoiceRes.status, 200);
    assert.equal(paidInvoice.status, 'paid');

    const changeRequestRes = await fetch(`${server.origin}/projectops/project-requests/req-2/change-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'change-1',
        title: 'Add analytics event tracking',
        description: 'Track contact form conversions after launch.',
        requestedBy: 'Boulos',
        estimateDeltaCents: 45000,
        estimateCurrency: 'USD',
        requestedAtIso: T3,
      }),
    });
    const changeRequest = await changeRequestRes.json() as ProjectChangeRequest;
    assert.equal(changeRequestRes.status, 200);
    assert.equal(changeRequest.status, 'proposed');

    const changeRequestsRes = await fetch(`${server.origin}/projectops/project-requests/req-2/change-requests`);
    assert.equal(changeRequestsRes.status, 200);
    const changeRequests = await changeRequestsRes.json() as readonly ProjectChangeRequest[];
    assert.equal(changeRequests.length, 1);

    const approveChangeRequestRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/change-requests/change-1/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decidedBy: 'Client',
          decidedAtIso: T3,
          decisionNote: 'Approved for launch reporting.',
        }),
      }
    );
    const approvedChangeRequest = await approveChangeRequestRes.json() as ProjectChangeRequest;
    assert.equal(approveChangeRequestRes.status, 200);
    assert.equal(approvedChangeRequest.status, 'approved');

    const issueRes = await fetch(`${server.origin}/projectops/project-requests/req-2/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'issue-1',
        title: 'Waiting on launch assets',
        description: 'Client still needs to send final launch images.',
        severity: 'high',
        owner: 'Client',
        openedAtIso: T3,
      }),
    });
    const issue = await issueRes.json() as ProjectIssue;
    assert.equal(issueRes.status, 200);
    assert.equal(issue.status, 'open');
    assert.equal(issue.severity, 'high');

    const issuesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/issues`);
    assert.equal(issuesRes.status, 200);
    const issues = await issuesRes.json() as readonly ProjectIssue[];
    assert.equal(issues.length, 1);

    const resolveIssueRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/issues/issue-1/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resolvedAtIso: T3,
          resolutionNote: 'Assets received.',
        }),
      }
    );
    const resolvedIssue = await resolveIssueRes.json() as ProjectIssue;
    assert.equal(resolveIssueRes.status, 200);
    assert.equal(resolvedIssue.status, 'resolved');

    const riskRes = await fetch(`${server.origin}/projectops/project-requests/req-2/risks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'risk-1',
        title: 'Late content delivery',
        description: 'Client content may arrive after implementation starts.',
        probability: 'high',
        impact: 'medium',
        mitigationPlan: 'Prepare placeholder copy and confirm deadline.',
        owner: 'Boulos',
        identifiedAtIso: T2,
      }),
    });
    const risk = await riskRes.json() as ProjectRisk;
    assert.equal(riskRes.status, 200);
    assert.equal(risk.status, 'open');
    assert.equal(risk.probability, 'high');

    const risksRes = await fetch(`${server.origin}/projectops/project-requests/req-2/risks`);
    assert.equal(risksRes.status, 200);
    const risks = await risksRes.json() as readonly ProjectRisk[];
    assert.equal(risks.length, 1);

    const mitigateRiskRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/risks/risk-1/mitigate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mitigatedAtIso: T3,
          mitigationNote: 'Client approved placeholder copy.',
        }),
      }
    );
    const mitigatedRisk = await mitigateRiskRes.json() as ProjectRisk;
    assert.equal(mitigateRiskRes.status, 200);
    assert.equal(mitigatedRisk.status, 'mitigated');

    const feedbackRes = await fetch(`${server.origin}/projectops/project-requests/req-2/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'feedback-1',
        deliverableId: 'deliverable-1',
        author: 'Client',
        sentiment: 'negative',
        message: 'Please make the launch checklist clearer.',
        receivedAtIso: T3,
      }),
    });
    const feedback = await feedbackRes.json() as ProjectFeedback;
    assert.equal(feedbackRes.status, 200);
    assert.equal(feedback.status, 'open');
    assert.equal(feedback.sentiment, 'negative');

    const feedbackListRes = await fetch(`${server.origin}/projectops/project-requests/req-2/feedback`);
    assert.equal(feedbackListRes.status, 200);
    const feedbackList = await feedbackListRes.json() as readonly ProjectFeedback[];
    assert.equal(feedbackList.length, 1);

    const addressFeedbackRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/feedback/feedback-1/address`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          addressedBy: 'Boulos',
          addressedAtIso: T3,
          responseNote: 'Checklist rewritten with client acceptance notes.',
        }),
      }
    );
    const addressedFeedback = await addressFeedbackRes.json() as ProjectFeedback;
    assert.equal(addressFeedbackRes.status, 200);
    assert.equal(addressedFeedback.status, 'addressed');

    const documentRes = await fetch(`${server.origin}/projectops/project-requests/req-2/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'document-1',
        deliverableId: 'deliverable-1',
        title: 'Signed launch checklist',
        documentType: 'handoff',
        url: 'https://example.com/projectops/checklist.pdf',
        uploadedBy: 'Boulos',
        uploadedAtIso: T3,
      }),
    });
    const document = await documentRes.json() as ProjectDocument;
    assert.equal(documentRes.status, 200);
    assert.equal(document.status, 'active');
    assert.equal(document.documentType, 'handoff');

    const documentsRes = await fetch(`${server.origin}/projectops/project-requests/req-2/documents`);
    assert.equal(documentsRes.status, 200);
    const documents = await documentsRes.json() as readonly ProjectDocument[];
    assert.equal(documents.length, 1);

    const archiveDocumentRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/documents/document-1/archive`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          archivedBy: 'Boulos',
          archivedAtIso: T3,
        }),
      }
    );
    const archivedDocument = await archiveDocumentRes.json() as ProjectDocument;
    assert.equal(archiveDocumentRes.status, 200);
    assert.equal(archivedDocument.status, 'archived');

    const noteRes = await fetch(`${server.origin}/projectops/project-requests/req-2/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'note-1',
        author: 'Boulos',
        visibility: 'client',
        body: 'Client asked for a clearer launch checklist.',
        createdAtIso: T3,
      }),
    });
    const note = await noteRes.json() as ProjectNote;
    assert.equal(noteRes.status, 200);
    assert.equal(note.status, 'active');
    assert.equal(note.visibility, 'client');

    const notesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/notes`);
    assert.equal(notesRes.status, 200);
    const notes = await notesRes.json() as readonly ProjectNote[];
    assert.equal(notes.length, 1);

    const archiveNoteRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/notes/note-1/archive`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          archivedBy: 'Boulos',
          archivedAtIso: T3,
        }),
      }
    );
    const archivedNote = await archiveNoteRes.json() as ProjectNote;
    assert.equal(archiveNoteRes.status, 200);
    assert.equal(archivedNote.status, 'archived');

    const taskRes = await fetch(`${server.origin}/projectops/project-requests/req-2/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'task-1',
        title: 'Launch QA checklist',
        description: 'Run the launch checklist before client handoff.',
        assignee: 'Boulos',
        priority: 'high',
        dueAtIso: T3,
        createdAtIso: T2,
      }),
    });
    const task = await taskRes.json() as ProjectTask;
    assert.equal(taskRes.status, 200);
    assert.equal(task.status, 'open');
    assert.equal(task.priority, 'high');

    const tasksRes = await fetch(`${server.origin}/projectops/project-requests/req-2/tasks`);
    assert.equal(tasksRes.status, 200);
    const tasks = await tasksRes.json() as readonly ProjectTask[];
    assert.equal(tasks.length, 1);

    const completeTaskRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/tasks/task-1/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          completedBy: 'Boulos',
          completedAtIso: T3,
        }),
      }
    );
    const completedTask = await completeTaskRes.json() as ProjectTask;
    assert.equal(completeTaskRes.status, 200);
    assert.equal(completedTask.status, 'completed');
    assert.equal(completedTask.completedBy, 'Boulos');

    const workLogRes = await fetch(`${server.origin}/projectops/project-requests/req-2/work-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'work-1',
        taskId: 'task-1',
        actor: 'Boulos',
        minutes: 120,
        billable: true,
        note: 'Completed launch QA checklist.',
        loggedAtIso: T3,
      }),
    });
    const workLog = await workLogRes.json() as ProjectWorkLog;
    assert.equal(workLogRes.status, 200);
    assert.equal(workLog.minutes, 120);
    assert.equal(workLog.billable, true);

    const workLogsRes = await fetch(`${server.origin}/projectops/project-requests/req-2/work-logs`);
    assert.equal(workLogsRes.status, 200);
    const workLogs = await workLogsRes.json() as readonly ProjectWorkLog[];
    assert.equal(workLogs.length, 1);

    const expenseRes = await fetch(`${server.origin}/projectops/project-requests/req-2/expenses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'expense-1',
        category: 'software',
        description: 'Analytics license',
        vendor: 'MetricsCo',
        amountCents: 4500,
        currency: 'USD',
        reimbursable: true,
        receiptUrl: 'https://example.com/projectops/receipt.pdf',
        incurredAtIso: T3,
      }),
    });
    const expense = await expenseRes.json() as ProjectExpense;
    assert.equal(expenseRes.status, 200);
    assert.equal(expense.status, 'submitted');

    const expensesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/expenses`);
    assert.equal(expensesRes.status, 200);
    const expenses = await expensesRes.json() as readonly ProjectExpense[];
    assert.equal(expenses.length, 1);

    const approveExpenseRes = await fetch(
      `${server.origin}/projectops/project-requests/req-2/expenses/expense-1/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decidedBy: 'Boulos',
          decidedAtIso: T3,
          decisionNote: 'Approved for launch reporting.',
        }),
      }
    );
    const approvedExpense = await approveExpenseRes.json() as ProjectExpense;
    assert.equal(approveExpenseRes.status, 200);
    assert.equal(approvedExpense.status, 'approved');

    const activityRes = await fetch(`${server.origin}/projectops/project-requests/req-2/activities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'activity-1',
        eventType: 'note_added',
        summary: 'Client confirmed invoice payment.',
        actor: 'Boulos',
        happenedAtIso: T3,
      }),
    });
    const activity = await activityRes.json() as ProjectActivity;
    assert.equal(activityRes.status, 200);
    assert.equal(activity.eventType, 'note_added');

    const activitiesRes = await fetch(`${server.origin}/projectops/project-requests/req-2/activities`);
    assert.equal(activitiesRes.status, 200);
    const activities = await activitiesRes.json() as readonly ProjectActivity[];
    assert.equal(activities.length, 1);
    assert.equal(activities[0]?.summary, 'Client confirmed invoice payment.');

    const dashboardRes = await fetch(`${server.origin}/projectops/dashboard`);
    assert.equal(dashboardRes.status, 200);
    const dashboard = await dashboardRes.json() as ProjectOpsDashboardView;
    assert.equal(dashboard.totalActiveRequests, 2);
    assert.equal(dashboard.byStatus.estimated, 1);
    assert.equal(dashboard.byStatus.approved, 1);
    assert.equal(dashboard.openMilestones, 0);
    assert.equal(dashboard.completedMilestones, 1);
    assert.equal(dashboard.submittedDeliverables, 0);
    assert.equal(dashboard.acceptedDeliverables, 1);
    assert.equal(dashboard.issuedInvoices, 0);
    assert.equal(dashboard.paidInvoices, 1);
    assert.equal(dashboard.paidInvoiceAmountCents, 180000);
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
    assert.equal(dashboard.submittedExpenses, 0);
    assert.equal(dashboard.approvedExpenses, 1);
    assert.equal(dashboard.approvedExpenseAmountCents, 4500);
    assert.equal(
      dashboard.rows.find((row) => row.id === 'req-2')?.latestActivitySummary,
      'Client confirmed invoice payment.'
    );
  } finally {
    await server.close();
  }
});

unitTest('PROJECTOPS-005: web dashboard boundary exposes a product page view model', () => {
  const page = composeProjectOpsDashboardPage([
    {
      id: 'req-1',
      clientId: 'client-1',
      clientName: 'Zad Studio',
      title: 'Delivery board',
      priority: 'medium',
      status: 'approved',
      deadlineIso: '2026-10-10T00:00:00.000Z',
      estimateAmountCents: 250000,
      estimateCurrency: 'USD',
      estimatedAtIso: T1,
      approvedAtIso: T2,
      approvedBy: 'Boulos',
      openMilestoneCount: 1,
      completedMilestoneCount: 2,
      submittedDeliverableCount: 1,
      acceptedDeliverableCount: 3,
      issuedInvoiceCount: 1,
      paidInvoiceCount: 2,
      outstandingInvoiceAmountCents: 120000,
      paidInvoiceAmountCents: 240000,
      proposedChangeRequestCount: 1,
      approvedChangeRequestCount: 2,
      rejectedChangeRequestCount: 0,
      openIssueCount: 1,
      highOpenIssueCount: 1,
      resolvedIssueCount: 2,
      openFeedbackCount: 1,
      addressedFeedbackCount: 2,
      negativeOpenFeedbackCount: 1,
      activeDocumentCount: 2,
      archivedDocumentCount: 1,
      activeNoteCount: 2,
      archivedNoteCount: 1,
      clientVisibleNoteCount: 1,
      openTaskCount: 2,
      highOpenTaskCount: 1,
      completedTaskCount: 1,
      nextTaskDueAtIso: T3,
      workLogCount: 2,
      billableWorkMinutes: 180,
      nonBillableWorkMinutes: 30,
      latestWorkLoggedAtIso: T3,
      submittedExpenseCount: 1,
      approvedExpenseCount: 2,
      rejectedExpenseCount: 0,
      submittedExpenseAmountCents: 4500,
      approvedExpenseAmountCents: 9000,
      latestActivityAtIso: T3,
      latestActivitySummary: 'Client accepted final delivery.',
      updatedAtIso: T1,
    },
  ]);

  assert.equal(page.title, 'ProjectOps Dashboard');
  assert.equal(page.summary.totalActiveRequests, 1);
  assert.equal(page.summary.byStatus.approved, 1);
  assert.equal(page.summary.nextDeadline?.id, 'req-1');
});

unitTest('PROJECTOPS-006: product domain rejects unsafe or malformed input', () => {
  assert.throws(
    () =>
      createClient({
        id: '../client',
        name: 'Zad Studio',
        createdAtIso: T0,
      }),
    /client.id must start with a letter or number/
  );

  assert.throws(
    () =>
      createClient({
        id: 'client-1',
        name: 'Zad Studio',
        email: 'not-an-email',
        createdAtIso: T0,
      }),
    /client.email must be a valid email/
  );

  assert.throws(
    () =>
      createProjectRequest({
        id: 'req-1',
        clientId: 'client-1',
        title: 'Delivery board',
        brief: 'A'.repeat(4001),
        createdAtIso: T0,
      }),
    /projectRequest.brief must be 4000 characters or fewer/
  );

  assert.throws(
    () =>
      createProjectRequest({
        id: 'req-1',
        clientId: 'client-1',
        title: 'Delivery board',
        brief: 'Valid brief.',
        deadlineIso: '2026-09-28T08:00:00.000Z',
        createdAtIso: T0,
      }),
    /deadlineIso must not be earlier/
  );
});

unitTest('PROJECTOPS-007: API maps product validation failures to client errors', async () => {
  const service = createMemoryProjectOpsService();
  const server = await startHttpListener({
    port: 0,
    routes: createProjectOpsRoutes(service, () => T0),
  });

  try {
    const response = await fetch(`${server.origin}/projectops/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: '../client',
        name: 'Zad Studio',
      }),
    });
    const body = await response.json() as { code: string; status: number };

    assert.equal(response.status, 400);
    assert.equal(body.status, 400);
    assert.equal(body.code, 'INVALID_PROJECTOPS_IDENTIFIER');
  } finally {
    await server.close();
  }
});

function createMemoryProjectOpsService(): ProjectOpsApiService {
  const clients = new Map<string, ProjectOpsClient>();
  const requests = new Map<string, ProjectRequest>();
  const milestones = new Map<string, ProjectMilestone>();
  const deliverables = new Map<string, ProjectDeliverable>();
  const invoices = new Map<string, ProjectInvoice>();
  const changeRequests = new Map<string, ProjectChangeRequest>();
  const issues = new Map<string, ProjectIssue>();
  const risks = new Map<string, ProjectRisk>();
  const feedback = new Map<string, ProjectFeedback>();
  const documents = new Map<string, ProjectDocument>();
  const notes = new Map<string, ProjectNote>();
  const tasks = new Map<string, ProjectTask>();
  const workLogs = new Map<string, ProjectWorkLog>();
  const expenses = new Map<string, ProjectExpense>();
  const activities = new Map<string, ProjectActivity>();

  return Object.freeze({
    async createClient(input: NewClientInput): Promise<ProjectOpsClient> {
      const client = createClient(input);
      clients.set(client.id, client);
      return client;
    },
    async createProjectRequest(input: NewProjectRequestInput): Promise<ProjectRequest> {
      if (!clients.has(input.clientId)) {
        throw new Error(`Client not found: ${input.clientId}`);
      }
      const request = createProjectRequest(input);
      requests.set(request.id, request);
      return request;
    },
    async listClients(): Promise<readonly ProjectOpsClient[]> {
      return Object.freeze([...clients.values()]);
    },
    async getClient(id: string): Promise<ProjectOpsClient | undefined> {
      return clients.get(id);
    },
    async listProjectRequests(): Promise<readonly ProjectRequest[]> {
      return Object.freeze([...requests.values()]);
    },
    async getProjectRequest(id: string): Promise<ProjectRequest | undefined> {
      return requests.get(id);
    },
    async createProjectMilestone(
      projectRequestId: string,
      input: NewProjectMilestoneInput
    ): Promise<ProjectMilestone> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const milestone = createProjectMilestone(request, input);
      milestones.set(milestoneKey(projectRequestId, milestone.id), milestone);
      return milestone;
    },
    async listProjectMilestones(projectRequestId: string): Promise<readonly ProjectMilestone[]> {
      return Object.freeze(
        [...milestones.values()].filter((milestone) => milestone.projectRequestId === projectRequestId)
      );
    },
    async completeProjectMilestone(
      projectRequestId: string,
      milestoneId: string,
      completedAtIso: string
    ): Promise<ProjectMilestone> {
      const key = milestoneKey(projectRequestId, milestoneId);
      const current = milestones.get(key);
      if (!current) {
        throw new Error(`Project milestone not found: ${projectRequestId}/${milestoneId}`);
      }
      const next = completeProjectMilestone(current, completedAtIso);
      milestones.set(key, next);
      return next;
    },
    async createProjectDeliverable(
      projectRequestId: string,
      input: NewProjectDeliverableInput
    ): Promise<ProjectDeliverable> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      if (input.milestoneId && !milestones.has(milestoneKey(projectRequestId, input.milestoneId))) {
        throw new Error(`Project milestone not found: ${projectRequestId}/${input.milestoneId}`);
      }
      const deliverable = createProjectDeliverable(request, input);
      deliverables.set(deliverableKey(projectRequestId, deliverable.id), deliverable);
      return deliverable;
    },
    async listProjectDeliverables(projectRequestId: string): Promise<readonly ProjectDeliverable[]> {
      return Object.freeze(
        [...deliverables.values()].filter((deliverable) => deliverable.projectRequestId === projectRequestId)
      );
    },
    async acceptProjectDeliverable(
      projectRequestId: string,
      deliverableId: string,
      acceptedAtIso: string
    ): Promise<ProjectDeliverable> {
      const key = deliverableKey(projectRequestId, deliverableId);
      const current = deliverables.get(key);
      if (!current) {
        throw new Error(`Project deliverable not found: ${projectRequestId}/${deliverableId}`);
      }
      const next = acceptProjectDeliverable(current, acceptedAtIso);
      deliverables.set(key, next);
      return next;
    },
    async createProjectInvoice(
      projectRequestId: string,
      input: NewProjectInvoiceInput
    ): Promise<ProjectInvoice> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      if (input.deliverableId) {
        const deliverable = deliverables.get(deliverableKey(projectRequestId, input.deliverableId));
        if (!deliverable) throw new Error(`Project deliverable not found: ${projectRequestId}/${input.deliverableId}`);
        if (deliverable.status !== 'accepted') throw new Error(`Project deliverable not accepted: ${input.deliverableId}`);
      }
      const invoice = createProjectInvoice(request, input);
      invoices.set(invoiceKey(projectRequestId, invoice.id), invoice);
      return invoice;
    },
    async listProjectInvoices(projectRequestId: string): Promise<readonly ProjectInvoice[]> {
      return Object.freeze(
        [...invoices.values()].filter((invoice) => invoice.projectRequestId === projectRequestId)
      );
    },
    async markProjectInvoicePaid(
      projectRequestId: string,
      invoiceId: string,
      paidAtIso: string
    ): Promise<ProjectInvoice> {
      const key = invoiceKey(projectRequestId, invoiceId);
      const current = invoices.get(key);
      if (!current) {
        throw new Error(`Project invoice not found: ${projectRequestId}/${invoiceId}`);
      }
      const next = markProjectInvoicePaid(current, paidAtIso);
      invoices.set(key, next);
      return next;
    },
    async createProjectChangeRequest(
      projectRequestId: string,
      input: NewProjectChangeRequestInput
    ): Promise<ProjectChangeRequest> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const changeRequest = createProjectChangeRequest(request, input);
      changeRequests.set(changeRequestKey(projectRequestId, changeRequest.id), changeRequest);
      return changeRequest;
    },
    async listProjectChangeRequests(projectRequestId: string): Promise<readonly ProjectChangeRequest[]> {
      return Object.freeze(
        [...changeRequests.values()]
          .filter((changeRequest) => changeRequest.projectRequestId === projectRequestId)
          .sort((a, b) => b.requestedAtIso.localeCompare(a.requestedAtIso) || a.id.localeCompare(b.id))
      );
    },
    async approveProjectChangeRequest(
      projectRequestId: string,
      changeRequestId: string,
      input: DecideProjectChangeRequestInput
    ): Promise<ProjectChangeRequest> {
      const key = changeRequestKey(projectRequestId, changeRequestId);
      const current = changeRequests.get(key);
      if (!current) {
        throw new Error(`Project change request not found: ${projectRequestId}/${changeRequestId}`);
      }
      const next = approveProjectChangeRequest(current, input);
      changeRequests.set(key, next);
      return next;
    },
    async rejectProjectChangeRequest(
      projectRequestId: string,
      changeRequestId: string,
      input: DecideProjectChangeRequestInput
    ): Promise<ProjectChangeRequest> {
      const key = changeRequestKey(projectRequestId, changeRequestId);
      const current = changeRequests.get(key);
      if (!current) {
        throw new Error(`Project change request not found: ${projectRequestId}/${changeRequestId}`);
      }
      const next = rejectProjectChangeRequest(current, input);
      changeRequests.set(key, next);
      return next;
    },
    async createProjectIssue(
      projectRequestId: string,
      input: NewProjectIssueInput
    ): Promise<ProjectIssue> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const issue = createProjectIssue(request, input);
      issues.set(issueKey(projectRequestId, issue.id), issue);
      return issue;
    },
    async listProjectIssues(projectRequestId: string): Promise<readonly ProjectIssue[]> {
      return Object.freeze(
        [...issues.values()]
          .filter((issue) => issue.projectRequestId === projectRequestId)
          .sort((a, b) => b.openedAtIso.localeCompare(a.openedAtIso) || a.id.localeCompare(b.id))
      );
    },
    async resolveProjectIssue(
      projectRequestId: string,
      issueId: string,
      input: ResolveProjectIssueInput
    ): Promise<ProjectIssue> {
      const key = issueKey(projectRequestId, issueId);
      const current = issues.get(key);
      if (!current) {
        throw new Error(`Project issue not found: ${projectRequestId}/${issueId}`);
      }
      const next = resolveProjectIssue(current, input);
      issues.set(key, next);
      return next;
    },
    async createProjectRisk(
      projectRequestId: string,
      input: NewProjectRiskInput
    ): Promise<ProjectRisk> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const risk = createProjectRisk(request, input);
      risks.set(riskKey(projectRequestId, risk.id), risk);
      return risk;
    },
    async listProjectRisks(projectRequestId: string): Promise<readonly ProjectRisk[]> {
      return Object.freeze(
        [...risks.values()]
          .filter((risk) => risk.projectRequestId === projectRequestId)
          .sort((a, b) => (
            b.identifiedAtIso.localeCompare(a.identifiedAtIso) ||
            b.updatedAtIso.localeCompare(a.updatedAtIso) ||
            a.id.localeCompare(b.id)
          ))
      );
    },
    async mitigateProjectRisk(
      projectRequestId: string,
      riskId: string,
      input: MitigateProjectRiskInput
    ): Promise<ProjectRisk> {
      const key = riskKey(projectRequestId, riskId);
      const current = risks.get(key);
      if (!current) {
        throw new Error(`Project risk not found: ${projectRequestId}/${riskId}`);
      }
      const next = mitigateProjectRisk(current, input);
      risks.set(key, next);
      return next;
    },
    async createProjectFeedback(
      projectRequestId: string,
      input: NewProjectFeedbackInput
    ): Promise<ProjectFeedback> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      if (input.deliverableId && !deliverables.has(deliverableKey(projectRequestId, input.deliverableId))) {
        throw new Error(`Project deliverable not found: ${projectRequestId}/${input.deliverableId}`);
      }
      const projectFeedback = createProjectFeedback(request, input);
      feedback.set(feedbackKey(projectRequestId, projectFeedback.id), projectFeedback);
      return projectFeedback;
    },
    async listProjectFeedback(projectRequestId: string): Promise<readonly ProjectFeedback[]> {
      return Object.freeze(
        [...feedback.values()]
          .filter((projectFeedback) => projectFeedback.projectRequestId === projectRequestId)
          .sort((a, b) => b.receivedAtIso.localeCompare(a.receivedAtIso) || a.id.localeCompare(b.id))
      );
    },
    async addressProjectFeedback(
      projectRequestId: string,
      feedbackId: string,
      input: AddressProjectFeedbackInput
    ): Promise<ProjectFeedback> {
      const key = feedbackKey(projectRequestId, feedbackId);
      const current = feedback.get(key);
      if (!current) {
        throw new Error(`Project feedback not found: ${projectRequestId}/${feedbackId}`);
      }
      const next = addressProjectFeedback(current, input);
      feedback.set(key, next);
      return next;
    },
    async createProjectDocument(
      projectRequestId: string,
      input: NewProjectDocumentInput
    ): Promise<ProjectDocument> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      if (input.deliverableId && !deliverables.has(deliverableKey(projectRequestId, input.deliverableId))) {
        throw new Error(`Project deliverable not found: ${projectRequestId}/${input.deliverableId}`);
      }
      const document = createProjectDocument(request, input);
      documents.set(documentKey(projectRequestId, document.id), document);
      return document;
    },
    async listProjectDocuments(projectRequestId: string): Promise<readonly ProjectDocument[]> {
      return Object.freeze(
        [...documents.values()]
          .filter((document) => document.projectRequestId === projectRequestId)
          .sort((a, b) => b.uploadedAtIso.localeCompare(a.uploadedAtIso) || a.id.localeCompare(b.id))
      );
    },
    async archiveProjectDocument(
      projectRequestId: string,
      documentId: string,
      input: ArchiveProjectDocumentInput
    ): Promise<ProjectDocument> {
      const key = documentKey(projectRequestId, documentId);
      const current = documents.get(key);
      if (!current) {
        throw new Error(`Project document not found: ${projectRequestId}/${documentId}`);
      }
      const next = archiveProjectDocument(current, input);
      documents.set(key, next);
      return next;
    },
    async createProjectNote(
      projectRequestId: string,
      input: NewProjectNoteInput
    ): Promise<ProjectNote> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const note = createProjectNote(request, input);
      notes.set(noteKey(projectRequestId, note.id), note);
      return note;
    },
    async listProjectNotes(projectRequestId: string): Promise<readonly ProjectNote[]> {
      return Object.freeze(
        [...notes.values()]
          .filter((note) => note.projectRequestId === projectRequestId)
          .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || a.id.localeCompare(b.id))
      );
    },
    async archiveProjectNote(
      projectRequestId: string,
      noteId: string,
      input: ArchiveProjectNoteInput
    ): Promise<ProjectNote> {
      const key = noteKey(projectRequestId, noteId);
      const current = notes.get(key);
      if (!current) {
        throw new Error(`Project note not found: ${projectRequestId}/${noteId}`);
      }
      const next = archiveProjectNote(current, input);
      notes.set(key, next);
      return next;
    },
    async createProjectTask(
      projectRequestId: string,
      input: NewProjectTaskInput
    ): Promise<ProjectTask> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const task = createProjectTask(request, input);
      tasks.set(taskKey(projectRequestId, task.id), task);
      return task;
    },
    async listProjectTasks(projectRequestId: string): Promise<readonly ProjectTask[]> {
      return Object.freeze(
        [...tasks.values()]
          .filter((task) => task.projectRequestId === projectRequestId)
          .sort((a, b) => (
            compareOptionalIso(a.dueAtIso, b.dueAtIso) ||
            b.createdAtIso.localeCompare(a.createdAtIso) ||
            a.id.localeCompare(b.id)
          ))
      );
    },
    async completeProjectTask(
      projectRequestId: string,
      taskId: string,
      input: CompleteProjectTaskInput
    ): Promise<ProjectTask> {
      const key = taskKey(projectRequestId, taskId);
      const current = tasks.get(key);
      if (!current) {
        throw new Error(`Project task not found: ${projectRequestId}/${taskId}`);
      }
      const next = completeProjectTask(current, input);
      tasks.set(key, next);
      return next;
    },
    async createProjectWorkLog(
      projectRequestId: string,
      input: NewProjectWorkLogInput
    ): Promise<ProjectWorkLog> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      if (input.taskId && !tasks.has(taskKey(projectRequestId, input.taskId))) {
        throw new Error(`Project task not found: ${projectRequestId}/${input.taskId}`);
      }
      const workLog = createProjectWorkLog(request, input);
      workLogs.set(workLogKey(projectRequestId, workLog.id), workLog);
      return workLog;
    },
    async listProjectWorkLogs(projectRequestId: string): Promise<readonly ProjectWorkLog[]> {
      return Object.freeze(
        [...workLogs.values()]
          .filter((workLog) => workLog.projectRequestId === projectRequestId)
          .sort((a, b) => (
            b.loggedAtIso.localeCompare(a.loggedAtIso) ||
            b.createdAtIso.localeCompare(a.createdAtIso) ||
            a.id.localeCompare(b.id)
          ))
      );
    },
    async createProjectExpense(
      projectRequestId: string,
      input: NewProjectExpenseInput
    ): Promise<ProjectExpense> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const expense = createProjectExpense(request, input);
      expenses.set(expenseKey(projectRequestId, expense.id), expense);
      return expense;
    },
    async listProjectExpenses(projectRequestId: string): Promise<readonly ProjectExpense[]> {
      return Object.freeze(
        [...expenses.values()]
          .filter((expense) => expense.projectRequestId === projectRequestId)
          .sort((a, b) => (
            b.incurredAtIso.localeCompare(a.incurredAtIso) ||
            b.updatedAtIso.localeCompare(a.updatedAtIso) ||
            a.id.localeCompare(b.id)
          ))
      );
    },
    async approveProjectExpense(
      projectRequestId: string,
      expenseId: string,
      input: DecideProjectExpenseInput
    ): Promise<ProjectExpense> {
      const key = expenseKey(projectRequestId, expenseId);
      const current = expenses.get(key);
      if (!current) {
        throw new Error(`Project expense not found: ${projectRequestId}/${expenseId}`);
      }
      const next = approveProjectExpense(current, input);
      expenses.set(key, next);
      return next;
    },
    async rejectProjectExpense(
      projectRequestId: string,
      expenseId: string,
      input: DecideProjectExpenseInput
    ): Promise<ProjectExpense> {
      const key = expenseKey(projectRequestId, expenseId);
      const current = expenses.get(key);
      if (!current) {
        throw new Error(`Project expense not found: ${projectRequestId}/${expenseId}`);
      }
      const next = rejectProjectExpense(current, input);
      expenses.set(key, next);
      return next;
    },
    async createProjectActivity(
      projectRequestId: string,
      input: NewProjectActivityInput
    ): Promise<ProjectActivity> {
      const request = requests.get(projectRequestId);
      if (!request) {
        throw new Error(`Project request not found: ${projectRequestId}`);
      }
      const activity = createProjectActivity(request, input);
      activities.set(activityKey(projectRequestId, activity.id), activity);
      return activity;
    },
    async listProjectActivities(projectRequestId: string): Promise<readonly ProjectActivity[]> {
      return Object.freeze(
        [...activities.values()]
          .filter((activity) => activity.projectRequestId === projectRequestId)
          .sort((a, b) => b.happenedAtIso.localeCompare(a.happenedAtIso) || a.id.localeCompare(b.id))
      );
    },
    async estimateProjectRequest(
      id: string,
      input: EstimateProjectRequestInput
    ): Promise<ProjectRequest> {
      const current = requests.get(id);
      if (!current) {
        throw new Error(`Project request not found: ${id}`);
      }
      const next = estimateProjectRequest(current, input);
      requests.set(next.id, next);
      return next;
    },
    async approveProjectRequest(
      id: string,
      input: ApproveProjectRequestInput
    ): Promise<ProjectRequest> {
      const current = requests.get(id);
      if (!current) {
        throw new Error(`Project request not found: ${id}`);
      }
      const next = approveProjectRequest(current, input);
      requests.set(next.id, next);
      return next;
    },
    async transitionProjectRequest(
      id: string,
      nextStatus: ProjectRequestStatus,
      nowIso: string
    ): Promise<ProjectRequest> {
      const current = requests.get(id);
      if (!current) {
        throw new Error(`Project request not found: ${id}`);
      }
      const next = transitionProjectRequest(current, nextStatus, nowIso);
      requests.set(next.id, next);
      return next;
    },
    async getDashboard(): Promise<ProjectOpsDashboardView> {
      return composeProjectOpsDashboard(
        [...requests.values()].map((request) => {
          const client = clients.get(request.clientId);
          if (!client) throw new Error(`Client not found: ${request.clientId}`);
          return {
            id: request.id,
            clientId: request.clientId,
            clientName: client.name,
            title: request.title,
            priority: request.priority,
            status: request.status,
            deadlineIso: request.deadlineIso,
            estimateAmountCents: request.estimateAmountCents,
            estimateCurrency: request.estimateCurrency,
            estimatedAtIso: request.estimatedAtIso,
            approvedAtIso: request.approvedAtIso,
            approvedBy: request.approvedBy,
            openMilestoneCount: countMilestones(milestones, request.id, 'open'),
            completedMilestoneCount: countMilestones(milestones, request.id, 'completed'),
            submittedDeliverableCount: countDeliverables(deliverables, request.id, 'submitted'),
            acceptedDeliverableCount: countDeliverables(deliverables, request.id, 'accepted'),
            issuedInvoiceCount: countInvoices(invoices, request.id, 'issued'),
            paidInvoiceCount: countInvoices(invoices, request.id, 'paid'),
            outstandingInvoiceAmountCents: sumInvoices(invoices, request.id, 'issued'),
            paidInvoiceAmountCents: sumInvoices(invoices, request.id, 'paid'),
            proposedChangeRequestCount: countChangeRequests(changeRequests, request.id, 'proposed'),
            approvedChangeRequestCount: countChangeRequests(changeRequests, request.id, 'approved'),
            rejectedChangeRequestCount: countChangeRequests(changeRequests, request.id, 'rejected'),
            openIssueCount: countIssues(issues, request.id, 'open'),
            highOpenIssueCount: countHighOpenIssues(issues, request.id),
            resolvedIssueCount: countIssues(issues, request.id, 'resolved'),
            openRiskCount: countRisks(risks, request.id, 'open'),
            highOpenRiskCount: countHighOpenRisks(risks, request.id),
            mitigatedRiskCount: countRisks(risks, request.id, 'mitigated'),
            openFeedbackCount: countFeedback(feedback, request.id, 'open'),
            addressedFeedbackCount: countFeedback(feedback, request.id, 'addressed'),
            negativeOpenFeedbackCount: countNegativeOpenFeedback(feedback, request.id),
            activeDocumentCount: countDocuments(documents, request.id, 'active'),
            archivedDocumentCount: countDocuments(documents, request.id, 'archived'),
            activeNoteCount: countNotes(notes, request.id, 'active'),
            archivedNoteCount: countNotes(notes, request.id, 'archived'),
            clientVisibleNoteCount: countClientVisibleNotes(notes, request.id),
            openTaskCount: countTasks(tasks, request.id, 'open'),
            highOpenTaskCount: countHighOpenTasks(tasks, request.id),
            completedTaskCount: countTasks(tasks, request.id, 'completed'),
            nextTaskDueAtIso: nextOpenTaskDueAt(tasks, request.id),
            workLogCount: countWorkLogs(workLogs, request.id),
            billableWorkMinutes: sumWorkMinutes(workLogs, request.id, true),
            nonBillableWorkMinutes: sumWorkMinutes(workLogs, request.id, false),
            latestWorkLoggedAtIso: latestWorkLog(workLogs, request.id)?.loggedAtIso,
            submittedExpenseCount: countExpenses(expenses, request.id, 'submitted'),
            approvedExpenseCount: countExpenses(expenses, request.id, 'approved'),
            rejectedExpenseCount: countExpenses(expenses, request.id, 'rejected'),
            submittedExpenseAmountCents: sumExpenses(expenses, request.id, 'submitted'),
            approvedExpenseAmountCents: sumExpenses(expenses, request.id, 'approved'),
            latestActivityAtIso: latestActivity(activities, request.id)?.happenedAtIso,
            latestActivitySummary: latestActivity(activities, request.id)?.summary,
            updatedAtIso: request.updatedAtIso,
          };
        })
      );
    },
  });
}

function milestoneKey(projectRequestId: string, milestoneId: string): string {
  return `${projectRequestId}\0${milestoneId}`;
}

function deliverableKey(projectRequestId: string, deliverableId: string): string {
  return `${projectRequestId}\0${deliverableId}`;
}

function invoiceKey(projectRequestId: string, invoiceId: string): string {
  return `${projectRequestId}\0${invoiceId}`;
}

function changeRequestKey(projectRequestId: string, changeRequestId: string): string {
  return `${projectRequestId}\0${changeRequestId}`;
}

function issueKey(projectRequestId: string, issueId: string): string {
  return `${projectRequestId}\0${issueId}`;
}

function riskKey(projectRequestId: string, riskId: string): string {
  return `${projectRequestId}\0${riskId}`;
}

function feedbackKey(projectRequestId: string, feedbackId: string): string {
  return `${projectRequestId}\0${feedbackId}`;
}

function documentKey(projectRequestId: string, documentId: string): string {
  return `${projectRequestId}\0${documentId}`;
}

function noteKey(projectRequestId: string, noteId: string): string {
  return `${projectRequestId}\0${noteId}`;
}

function taskKey(projectRequestId: string, taskId: string): string {
  return `${projectRequestId}\0${taskId}`;
}

function workLogKey(projectRequestId: string, workLogId: string): string {
  return `${projectRequestId}\0${workLogId}`;
}

function expenseKey(projectRequestId: string, expenseId: string): string {
  return `${projectRequestId}\0${expenseId}`;
}

function activityKey(projectRequestId: string, activityId: string): string {
  return `${projectRequestId}\0${activityId}`;
}

function countMilestones(
  milestones: ReadonlyMap<string, ProjectMilestone>,
  projectRequestId: string,
  status: ProjectMilestone['status']
): number {
  return [...milestones.values()].filter(
    (milestone) => milestone.projectRequestId === projectRequestId && milestone.status === status
  ).length;
}

function countDeliverables(
  deliverables: ReadonlyMap<string, ProjectDeliverable>,
  projectRequestId: string,
  status: ProjectDeliverable['status']
): number {
  return [...deliverables.values()].filter(
    (deliverable) => deliverable.projectRequestId === projectRequestId && deliverable.status === status
  ).length;
}

function countInvoices(
  invoices: ReadonlyMap<string, ProjectInvoice>,
  projectRequestId: string,
  status: ProjectInvoice['status']
): number {
  return [...invoices.values()].filter(
    (invoice) => invoice.projectRequestId === projectRequestId && invoice.status === status
  ).length;
}

function sumInvoices(
  invoices: ReadonlyMap<string, ProjectInvoice>,
  projectRequestId: string,
  status: ProjectInvoice['status']
): number {
  return [...invoices.values()]
    .filter((invoice) => invoice.projectRequestId === projectRequestId && invoice.status === status)
    .reduce((total, invoice) => total + invoice.amountCents, 0);
}

function countChangeRequests(
  changeRequests: ReadonlyMap<string, ProjectChangeRequest>,
  projectRequestId: string,
  status: ProjectChangeRequest['status']
): number {
  return [...changeRequests.values()].filter(
    (changeRequest) => changeRequest.projectRequestId === projectRequestId && changeRequest.status === status
  ).length;
}

function countIssues(
  issues: ReadonlyMap<string, ProjectIssue>,
  projectRequestId: string,
  status: ProjectIssue['status']
): number {
  return [...issues.values()].filter(
    (issue) => issue.projectRequestId === projectRequestId && issue.status === status
  ).length;
}

function countHighOpenIssues(
  issues: ReadonlyMap<string, ProjectIssue>,
  projectRequestId: string
): number {
  return [...issues.values()].filter(
    (issue) => issue.projectRequestId === projectRequestId && issue.status === 'open' && issue.severity === 'high'
  ).length;
}

function countRisks(
  risks: ReadonlyMap<string, ProjectRisk>,
  projectRequestId: string,
  status: ProjectRisk['status']
): number {
  return [...risks.values()].filter(
    (risk) => risk.projectRequestId === projectRequestId && risk.status === status
  ).length;
}

function countHighOpenRisks(
  risks: ReadonlyMap<string, ProjectRisk>,
  projectRequestId: string
): number {
  return [...risks.values()].filter(
    (risk) => (
      risk.projectRequestId === projectRequestId &&
      risk.status === 'open' &&
      (risk.impact === 'high' || risk.probability === 'high')
    )
  ).length;
}

function countFeedback(
  feedback: ReadonlyMap<string, ProjectFeedback>,
  projectRequestId: string,
  status: ProjectFeedback['status']
): number {
  return [...feedback.values()].filter(
    (projectFeedback) => projectFeedback.projectRequestId === projectRequestId && projectFeedback.status === status
  ).length;
}

function countNegativeOpenFeedback(
  feedback: ReadonlyMap<string, ProjectFeedback>,
  projectRequestId: string
): number {
  return [...feedback.values()].filter(
    (projectFeedback) => (
      projectFeedback.projectRequestId === projectRequestId &&
      projectFeedback.status === 'open' &&
      projectFeedback.sentiment === 'negative'
    )
  ).length;
}

function countDocuments(
  documents: ReadonlyMap<string, ProjectDocument>,
  projectRequestId: string,
  status: ProjectDocument['status']
): number {
  return [...documents.values()].filter(
    (document) => document.projectRequestId === projectRequestId && document.status === status
  ).length;
}

function countNotes(
  notes: ReadonlyMap<string, ProjectNote>,
  projectRequestId: string,
  status: ProjectNote['status']
): number {
  return [...notes.values()].filter(
    (note) => note.projectRequestId === projectRequestId && note.status === status
  ).length;
}

function countClientVisibleNotes(
  notes: ReadonlyMap<string, ProjectNote>,
  projectRequestId: string
): number {
  return [...notes.values()].filter(
    (note) => note.projectRequestId === projectRequestId && note.status === 'active' && note.visibility === 'client'
  ).length;
}

function countTasks(
  tasks: ReadonlyMap<string, ProjectTask>,
  projectRequestId: string,
  status: ProjectTask['status']
): number {
  return [...tasks.values()].filter(
    (task) => task.projectRequestId === projectRequestId && task.status === status
  ).length;
}

function countHighOpenTasks(
  tasks: ReadonlyMap<string, ProjectTask>,
  projectRequestId: string
): number {
  return [...tasks.values()].filter(
    (task) => task.projectRequestId === projectRequestId && task.status === 'open' && task.priority === 'high'
  ).length;
}

function nextOpenTaskDueAt(
  tasks: ReadonlyMap<string, ProjectTask>,
  projectRequestId: string
): string | undefined {
  return [...tasks.values()]
    .filter((task) => task.projectRequestId === projectRequestId && task.status === 'open' && task.dueAtIso)
    .sort((a, b) => (
      compareOptionalIso(a.dueAtIso, b.dueAtIso) ||
      b.createdAtIso.localeCompare(a.createdAtIso) ||
      a.id.localeCompare(b.id)
    ))[0]?.dueAtIso;
}

function countWorkLogs(
  workLogs: ReadonlyMap<string, ProjectWorkLog>,
  projectRequestId: string
): number {
  return [...workLogs.values()].filter(
    (workLog) => workLog.projectRequestId === projectRequestId
  ).length;
}

function sumWorkMinutes(
  workLogs: ReadonlyMap<string, ProjectWorkLog>,
  projectRequestId: string,
  billable: boolean
): number {
  return [...workLogs.values()]
    .filter((workLog) => workLog.projectRequestId === projectRequestId && workLog.billable === billable)
    .reduce((total, workLog) => total + workLog.minutes, 0);
}

function latestWorkLog(
  workLogs: ReadonlyMap<string, ProjectWorkLog>,
  projectRequestId: string
): ProjectWorkLog | undefined {
  return [...workLogs.values()]
    .filter((workLog) => workLog.projectRequestId === projectRequestId)
    .sort((a, b) => (
      b.loggedAtIso.localeCompare(a.loggedAtIso) ||
      b.createdAtIso.localeCompare(a.createdAtIso) ||
      a.id.localeCompare(b.id)
    ))[0];
}

function countExpenses(
  expenses: ReadonlyMap<string, ProjectExpense>,
  projectRequestId: string,
  status: ProjectExpense['status']
): number {
  return [...expenses.values()].filter(
    (expense) => expense.projectRequestId === projectRequestId && expense.status === status
  ).length;
}

function sumExpenses(
  expenses: ReadonlyMap<string, ProjectExpense>,
  projectRequestId: string,
  status: ProjectExpense['status']
): number {
  return [...expenses.values()]
    .filter((expense) => expense.projectRequestId === projectRequestId && expense.status === status)
    .reduce((total, expense) => total + expense.amountCents, 0);
}

function latestActivity(
  activities: ReadonlyMap<string, ProjectActivity>,
  projectRequestId: string
): ProjectActivity | undefined {
  return [...activities.values()]
    .filter((activity) => activity.projectRequestId === projectRequestId)
    .sort((a, b) => b.happenedAtIso.localeCompare(a.happenedAtIso) || a.id.localeCompare(b.id))[0];
}

function compareOptionalIso(a: string | undefined, b: string | undefined): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}
