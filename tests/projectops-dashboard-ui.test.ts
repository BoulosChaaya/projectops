import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  ProjectOpsMemorySqlExecutor,
  ProjectOpsRepository,
  applyProjectOpsMigrations,
} from '../packages/projectops/src/index.ts';
import {
  composeProjectOpsDashboardPage,
  composeProjectOpsDashboardPageFromSummary,
} from '../apps/web/src/projectops/dashboard-view.ts';
import { renderProjectOpsDashboardPage } from '../apps/web/src/projectops/dashboard-renderer.ts';
import { createProjectOpsDashboardWebRoute } from '../apps/web/src/projectops/dashboard-route.ts';
import { startHttpListener } from '../apps/api/src/bootstrap/http-listener.ts';
import { serializeResponse } from '../apps/api/src/http/response.ts';

const T0 = '2026-09-29T08:00:00.000Z';
const T1 = '2026-09-29T09:00:00.000Z';

unitTest('PROJECTOPS-UI-001: renders dashboard metrics and active request table', () => {
  const page = composeProjectOpsDashboardPage([
    {
      id: 'req-1',
      clientId: 'client-1',
      clientName: 'Zad Studio',
      title: 'Launch dashboard',
      priority: 'high',
      status: 'in_progress',
      deadlineIso: '2026-10-10T00:00:00.000Z',
      estimateAmountCents: 125000,
      estimateCurrency: 'USD',
      openMilestoneCount: 2,
      completedMilestoneCount: 1,
      submittedDeliverableCount: 1,
      acceptedDeliverableCount: 2,
      issuedInvoiceCount: 1,
      paidInvoiceCount: 2,
      outstandingInvoiceAmountCents: 125000,
      paidInvoiceAmountCents: 250000,
      proposedChangeRequestCount: 1,
      approvedChangeRequestCount: 2,
      rejectedChangeRequestCount: 0,
      openIssueCount: 2,
      highOpenIssueCount: 1,
      resolvedIssueCount: 3,
      openFeedbackCount: 2,
      addressedFeedbackCount: 1,
      negativeOpenFeedbackCount: 1,
      activeDocumentCount: 2,
      archivedDocumentCount: 1,
      activeNoteCount: 2,
      archivedNoteCount: 1,
      clientVisibleNoteCount: 1,
      openTaskCount: 2,
      highOpenTaskCount: 1,
      completedTaskCount: 1,
      nextTaskDueAtIso: T1,
      workLogCount: 2,
      billableWorkMinutes: 180,
      nonBillableWorkMinutes: 30,
      latestWorkLoggedAtIso: T1,
      submittedExpenseCount: 1,
      approvedExpenseCount: 2,
      rejectedExpenseCount: 0,
      submittedExpenseAmountCents: 4500,
      approvedExpenseAmountCents: 9000,
      latestActivityAtIso: T1,
      latestActivitySummary: 'Client approved launch copy.',
      updatedAtIso: T1,
    },
  ]);

  const rendered = renderProjectOpsDashboardPage(page);

  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(rendered.headers['cache-control'], 'private, no-cache, no-store');
  assert.match(rendered.html, /ProjectOps Dashboard/);
  assert.match(rendered.html, /Active requests/);
  assert.match(rendered.html, /High priority open/);
  assert.match(rendered.html, /Open milestones/);
  assert.match(rendered.html, /Submitted deliverables/);
  assert.match(rendered.html, /Outstanding invoices/);
  assert.match(rendered.html, /Proposed changes/);
  assert.match(rendered.html, /Open issues/);
  assert.match(rendered.html, /Open feedback/);
  assert.match(rendered.html, /Active documents/);
  assert.match(rendered.html, /Active notes/);
  assert.match(rendered.html, /Open tasks/);
  assert.match(rendered.html, /Billable hours/);
  assert.match(rendered.html, /Approved expenses/);
  assert.match(rendered.html, /Launch dashboard/);
  assert.match(rendered.html, /Zad Studio/);
  assert.match(rendered.html, /In Progress/);
  assert.match(rendered.html, /USD 1,250\.00/);
  assert.match(rendered.html, /1 done \/ 2 open/);
  assert.match(rendered.html, /2 accepted \/ 1 submitted/);
  assert.match(rendered.html, /2 paid \/ 1 open \(USD 1,250\.00\)/);
  assert.match(rendered.html, /1 proposed \/ 2 approved/);
  assert.match(rendered.html, /2 open \/ 1 high/);
  assert.match(rendered.html, /2 open \/ 1 negative/);
  assert.match(rendered.html, /2 active \/ 1 archived/);
  assert.match(rendered.html, /2 active \/ 1 client/);
  assert.match(rendered.html, /2 open \/ 1 high/);
  assert.match(rendered.html, /3\.0h billable \/ 0\.5h non/);
  assert.match(rendered.html, /1 submitted \/ 2 approved \(USD 90\.00\)/);
  assert.match(rendered.html, /Client approved launch copy/);
  assert.match(rendered.html, /High/);
});

unitTest('PROJECTOPS-UI-002: escapes unsafe dashboard text', () => {
  const page = composeProjectOpsDashboardPage([
    {
      id: 'req-<script>alert(1)</script>',
      clientId: 'client-1',
      clientName: 'Bad & "Co"',
      title: '<script>alert(1)</script>',
      priority: 'low',
      status: 'new',
      deadlineIso: undefined,
      updatedAtIso: T1,
    },
  ]);

  const rendered = renderProjectOpsDashboardPage(page);

  assert.equal(rendered.html.includes('<script>alert(1)</script>'), false);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered.html, /Bad &amp; &quot;Co&quot;/);
});

unitTest('PROJECTOPS-UI-003: renders empty state when no active requests exist', () => {
  const rendered = renderProjectOpsDashboardPage(composeProjectOpsDashboardPage([]));

  assert.match(rendered.html, /No active project requests yet/);
  assert.match(rendered.html, /0 shown/);
  assert.match(rendered.html, /No upcoming deadlines yet\./);
});

unitTest('PROJECTOPS-UI-004: renders persisted dashboard data from repository', async () => {
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
    title: 'Repository UI',
    brief: 'Render dashboard data after the repository persists it.',
    priority: 'medium',
    createdAtIso: T0,
  });
  await repo.estimateProjectRequest('req-1', {
    amountCents: 175000,
    currency: 'USD',
    estimatedAtIso: T1,
  });
  await repo.approveProjectRequest('req-1', {
    approvedBy: 'Boulos',
    approvedAtIso: T1,
  });
  await repo.createProjectActivity('req-1', {
    id: 'activity-1',
    projectRequestId: 'req-1',
    eventType: 'request_estimated',
    summary: 'Estimate sent to client.',
    actor: 'Boulos',
    happenedAtIso: T1,
  });
  await repo.createProjectChangeRequest('req-1', {
    id: 'change-1',
    projectRequestId: 'req-1',
    title: 'Add analytics event tracking',
    description: 'Track contact form conversions after launch.',
    requestedBy: 'Boulos',
    requestedAtIso: T1,
  });
  await repo.createProjectIssue('req-1', {
    id: 'issue-1',
    projectRequestId: 'req-1',
    title: 'Waiting on launch assets',
    description: 'Client still needs to send final launch images.',
    severity: 'high',
    owner: 'Client',
    openedAtIso: T1,
  });
  await repo.createProjectFeedback('req-1', {
    id: 'feedback-1',
    projectRequestId: 'req-1',
    author: 'Client',
    sentiment: 'negative',
    message: 'The estimate summary needs clearer acceptance notes.',
    receivedAtIso: T1,
  });
  await repo.createProjectDocument('req-1', {
    id: 'document-1',
    projectRequestId: 'req-1',
    title: 'Estimate PDF',
    documentType: 'proposal',
    url: 'https://example.com/projectops/estimate.pdf',
    uploadedBy: 'Boulos',
    uploadedAtIso: T1,
  });
  await repo.createProjectNote('req-1', {
    id: 'note-1',
    projectRequestId: 'req-1',
    author: 'Boulos',
    visibility: 'client',
    body: 'Client asked for clearer acceptance notes.',
    createdAtIso: T1,
  });
  await repo.createProjectTask('req-1', {
    id: 'task-1',
    projectRequestId: 'req-1',
    title: 'Launch QA checklist',
    assignee: 'Boulos',
    priority: 'high',
    dueAtIso: T1,
    createdAtIso: T1,
  });
  await repo.createProjectWorkLog('req-1', {
    id: 'work-1',
    projectRequestId: 'req-1',
    taskId: 'task-1',
    actor: 'Boulos',
    minutes: 90,
    billable: true,
    loggedAtIso: T1,
  });
  const expense = await repo.createProjectExpense('req-1', {
    id: 'expense-1',
    projectRequestId: 'req-1',
    category: 'software',
    description: 'Analytics license',
    amountCents: 4500,
    currency: 'USD',
    incurredAtIso: T1,
  });
  await repo.approveProjectExpense('req-1', expense.id, {
    decidedBy: 'Boulos',
    decidedAtIso: T1,
  });

  const summary = await repo.getDashboard();
  const page = composeProjectOpsDashboardPageFromSummary(summary);
  const rendered = renderProjectOpsDashboardPage(page);

  assert.match(rendered.html, /Repository UI/);
  assert.match(rendered.html, /Zad Studio/);
  assert.match(rendered.html, /Approved/);
  assert.match(rendered.html, /USD 1,750\.00/);
  assert.match(rendered.html, /1 proposed \/ 0 approved/);
  assert.match(rendered.html, /1 open \/ 1 high/);
  assert.match(rendered.html, /1 open \/ 1 negative/);
  assert.match(rendered.html, /1 active \/ 0 archived/);
  assert.match(rendered.html, /1 active \/ 1 client/);
  assert.match(rendered.html, /1 open \/ 1 high/);
  assert.match(rendered.html, /1\.5h billable \/ 0\.0h non/);
  assert.match(rendered.html, /0 submitted \/ 1 approved \(USD 45\.00\)/);
  assert.match(rendered.html, /Estimate sent to client/);
  assert.match(rendered.html, /1 shown/);
});

unitTest('PROJECTOPS-UI-005: HTTP serializer preserves explicit HTML responses', () => {
  const serialized = serializeResponse(
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<h1>ProjectOps</h1>',
    },
    { correlationId: 'corr-ui' }
  );

  assert.equal(serialized.status, 200);
  assert.equal(serialized.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(serialized.headers['content-length'], '19');
  assert.equal(serialized.headers['x-correlation-id'], 'corr-ui');
  assert.equal(serialized.body.toString('utf8'), '<h1>ProjectOps</h1>');
});

unitTest('PROJECTOPS-UI-006: web route serves repository-backed dashboard HTML', async () => {
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
    title: 'Browser dashboard',
    brief: 'Serve the dashboard through the HTTP listener.',
    priority: 'high',
    createdAtIso: T0,
  });
  await repo.estimateProjectRequest('req-1', {
    amountCents: 210000,
    currency: 'USD',
    estimatedAtIso: T1,
  });
  await repo.approveProjectRequest('req-1', {
    approvedBy: 'Boulos',
    approvedAtIso: T1,
  });
  const milestone = await repo.createProjectMilestone('req-1', {
    id: 'milestone-1',
    projectRequestId: 'req-1',
    title: 'Prepare launch handoff',
    createdAtIso: T1,
  });
  await repo.createProjectDeliverable('req-1', {
    id: 'deliverable-1',
    projectRequestId: 'req-1',
    milestoneId: milestone.id,
    title: 'Launch package',
    artifactUrl: 'https://example.com/projectops/launch-package',
    submittedAtIso: T1,
  });
  await repo.acceptProjectDeliverable('req-1', 'deliverable-1', T1);
  await repo.createProjectInvoice('req-1', {
    id: 'invoice-1',
    projectRequestId: 'req-1',
    deliverableId: 'deliverable-1',
    invoiceNumber: 'INV-001',
    amountCents: 210000,
    currency: 'USD',
    issuedAtIso: T1,
  });
  await repo.createProjectActivity('req-1', {
    id: 'activity-1',
    projectRequestId: 'req-1',
    eventType: 'invoice_issued',
    summary: 'Invoice issued after accepted handoff.',
    actor: 'Boulos',
    happenedAtIso: T1,
  });
  await repo.createProjectChangeRequest('req-1', {
    id: 'change-1',
    projectRequestId: 'req-1',
    title: 'Add final QA pass',
    description: 'Run one additional handoff QA pass before launch.',
    requestedBy: 'Boulos',
    requestedAtIso: T1,
  });
  await repo.createProjectIssue('req-1', {
    id: 'issue-1',
    projectRequestId: 'req-1',
    title: 'Waiting on QA signoff',
    description: 'Client needs to confirm final QA result.',
    severity: 'medium',
    owner: 'Client',
    openedAtIso: T1,
  });
  await repo.createProjectFeedback('req-1', {
    id: 'feedback-1',
    projectRequestId: 'req-1',
    deliverableId: 'deliverable-1',
    author: 'Client',
    sentiment: 'neutral',
    message: 'Please add a short acceptance note to the handoff.',
    receivedAtIso: T1,
  });
  await repo.createProjectDocument('req-1', {
    id: 'document-1',
    projectRequestId: 'req-1',
    deliverableId: 'deliverable-1',
    title: 'Launch handoff PDF',
    documentType: 'handoff',
    url: 'https://example.com/projectops/launch-handoff.pdf',
    uploadedBy: 'Boulos',
    uploadedAtIso: T1,
  });
  await repo.createProjectNote('req-1', {
    id: 'note-1',
    projectRequestId: 'req-1',
    author: 'Boulos',
    visibility: 'internal',
    body: 'Follow up on QA signoff before launch.',
    createdAtIso: T1,
  });
  await repo.createProjectTask('req-1', {
    id: 'task-1',
    projectRequestId: 'req-1',
    title: 'Confirm launch checklist',
    assignee: 'Boulos',
    priority: 'medium',
    dueAtIso: T1,
    createdAtIso: T1,
  });
  await repo.createProjectWorkLog('req-1', {
    id: 'work-1',
    projectRequestId: 'req-1',
    taskId: 'task-1',
    actor: 'Boulos',
    minutes: 60,
    billable: false,
    loggedAtIso: T1,
  });
  await repo.createProjectExpense('req-1', {
    id: 'expense-1',
    projectRequestId: 'req-1',
    category: 'asset',
    description: 'Stock photo',
    amountCents: 2500,
    currency: 'USD',
    incurredAtIso: T1,
  });

  const server = await startHttpListener({
    port: 0,
    routes: [createProjectOpsDashboardWebRoute(repo)],
  });

  try {
    const response = await fetch(`${server.origin}/projectops`, {
      headers: { accept: 'text/html' },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'private, no-cache, no-store');
    assert.match(html, /ProjectOps Dashboard/);
    assert.match(html, /Browser dashboard/);
    assert.match(html, /Approved/);
    assert.match(html, /USD 2,100\.00/);
    assert.match(html, /0 done \/ 1 open/);
    assert.match(html, /1 accepted \/ 0 submitted/);
    assert.match(html, /0 paid \/ 1 open \(USD 2,100\.00\)/);
    assert.match(html, /1 proposed \/ 0 approved/);
    assert.match(html, /1 open \/ 0 high/);
    assert.match(html, /1 open \/ 0 negative/);
    assert.match(html, /1 active \/ 0 archived/);
    assert.match(html, /1 active \/ 0 client/);
    assert.match(html, /1 open \/ 0 high/);
    assert.match(html, /0\.0h billable \/ 1\.0h non/);
    assert.match(html, /1 submitted \/ 0 approved \(USD 0\.00\)/);
    assert.match(html, /Invoice issued after accepted handoff/);
    assert.match(html, /Zad Studio/);
  } finally {
    await server.close();
  }
});
