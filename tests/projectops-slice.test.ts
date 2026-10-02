import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  ProjectOpsRepository,
  acceptProjectDeliverable,
  approveProjectRequest,
  composeProjectOpsDashboard,
  createClient,
  createProjectDeliverable,
  createProjectInvoice,
  createProjectMilestone,
  createProjectRequest,
  estimateProjectRequest,
  markProjectInvoicePaid,
  completeProjectMilestone,
  insertClientSql,
  insertProjectRequestSql,
  projectOpsSchemaSql,
  transitionProjectRequest,
  type ApproveProjectRequestInput,
  type EstimateProjectRequestInput,
  type NewProjectDeliverableInput,
  type NewProjectInvoiceInput,
  type NewClientInput,
  type NewProjectMilestoneInput,
  type NewProjectRequestInput,
  type ProjectDeliverable,
  type ProjectInvoice,
  type ProjectOpsClient,
  type ProjectOpsDashboardView,
  type ProjectMilestone,
  type ProjectRequest,
  type ProjectRequestStatus,
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

  const estimated = transitionProjectRequest(request, 'estimated', T1);
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

  const transitioned = await repo.transitionProjectRequest('req-1', 'estimated', T1);
  const dashboard = await repo.getDashboard();

  assert.equal(transitioned.status, 'estimated');
  assert.equal(dashboard.totalActiveRequests, 1);
  assert.equal(dashboard.highPriorityOpen, 1);
  assert.equal(executed.length, 3);
  assert.deepEqual(executed[0].params, ['req-1']);
  assert.deepEqual(executed[1].params, ['req-1', 'estimated', T1]);
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
    assert.equal(transitionRes.status, 200);
    assert.equal((await transitionRes.json() as ProjectRequest).status, 'estimated');

    const estimateRes = await fetch(`${server.origin}/projectops/project-requests/req-1/estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountCents: 180000, currency: 'USD', estimatedAtIso: T1 }),
    });
    assert.equal(estimateRes.status, 400);

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
