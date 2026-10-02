import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  ProjectOpsRepository,
  composeProjectOpsDashboard,
  createClient,
  createProjectRequest,
  insertClientSql,
  insertProjectRequestSql,
  projectOpsSchemaSql,
  transitionProjectRequest,
  type NewClientInput,
  type NewProjectRequestInput,
  type ProjectOpsClient,
  type ProjectOpsDashboardView,
  type ProjectRequest,
  type ProjectRequestStatus,
  type SqlStatement,
} from '../packages/projectops/src/index.ts';
import { createProjectOpsRoutes, type ProjectOpsApiService } from '../apps/api/src/projectops/routes.ts';
import { startHttpListener } from '../apps/api/src/bootstrap/http-listener.ts';
import { composeProjectOpsDashboardPage } from '../apps/web/src/projectops/dashboard-view.ts';

const T0 = '2026-09-29T08:00:00.000Z';
const T1 = '2026-09-29T09:00:00.000Z';

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
  assert.match(clientInsert.sql, /\$1/);
  assert.match(requestInsert.sql, /\$10/);
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

    const dashboardRes = await fetch(`${server.origin}/projectops/dashboard`);
    assert.equal(dashboardRes.status, 200);
    const dashboard = await dashboardRes.json() as ProjectOpsDashboardView;
    assert.equal(dashboard.totalActiveRequests, 1);
    assert.equal(dashboard.byStatus.estimated, 1);
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
            updatedAtIso: request.updatedAtIso,
          };
        })
      );
    },
  });
}
