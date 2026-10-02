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
  type ProjectInvoice,
  type ProjectMilestone,
  type ProjectRequest,
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
  const milestones = await repo.listProjectMilestones('req-1');
  const clients = await repo.listClients();
  const fetchedClient = await repo.getClient('client-1');
  const requests = await repo.listProjectRequests();
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
  assert.equal(dashboard.totalActiveRequests, 1);
  assert.equal(dashboard.byStatus.approved, 1);
  assert.equal(dashboard.openMilestones, 0);
  assert.equal(dashboard.completedMilestones, 1);
  assert.equal(dashboard.submittedDeliverables, 0);
  assert.equal(dashboard.acceptedDeliverables, 1);
  assert.equal(dashboard.issuedInvoices, 0);
  assert.equal(dashboard.paidInvoices, 1);
  assert.equal(dashboard.paidInvoiceAmountCents, 320000);
  assert.equal(dashboard.rows[0]?.clientName, 'Zad Studio');
  assert.equal(dashboard.rows[0]?.estimateAmountCents, 320000);
  assert.equal(dashboard.rows[0]?.completedMilestoneCount, 1);
  assert.equal(dashboard.rows[0]?.acceptedDeliverableCount, 1);
  assert.equal(dashboard.rows[0]?.paidInvoiceAmountCents, 320000);
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

    const clientsRes = await fetch(`${server.origin}/projectops/clients`);
    assert.equal(clientsRes.status, 200);
    const clients = await clientsRes.json() as readonly { id: string }[];
    assert.equal(clients[0]?.id, 'client-1');

    const clientRes = await fetch(`${server.origin}/projectops/clients/client-1`);
    assert.equal(clientRes.status, 200);
    assert.equal(((await clientRes.json()) as { name: string }).name, 'Zad Studio');

    const requestsRes = await fetch(`${server.origin}/projectops/project-requests`);
    assert.equal(requestsRes.status, 200);
    const requests = await requestsRes.json() as readonly { id: string }[];
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
    assert.equal(dashboard.paidInvoiceAmountCents, 240000);
    assert.equal(sql.snapshot().projectRequests[0]?.status, 'approved');
    assert.equal(sql.snapshot().projectMilestones[0]?.status, 'completed');
    assert.equal(sql.snapshot().projectDeliverables[0]?.status, 'accepted');
    assert.equal(sql.snapshot().projectInvoices[0]?.status, 'paid');
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
    }, 400, 'PROJECTOPS_REQUEST_NOT_READY_FOR_DELIVERABLES');

    await expectProjectOpsError(`${server.origin}/projectops/project-requests/req-1/invoices`, {
      id: 'invoice-not-ready',
      invoiceNumber: 'INV-NOT-READY',
      amountCents: 100000,
      currency: 'USD',
    }, 400, 'PROJECTOPS_REQUEST_NOT_READY_FOR_INVOICES');
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
