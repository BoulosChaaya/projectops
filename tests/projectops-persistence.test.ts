import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { computeMigrationChecksum } from '../packages/db/src/migrations/index.ts';
import {
  ProjectOpsMemorySqlExecutor,
  ProjectOpsRepository,
  applyProjectOpsMigrations,
  projectOpsFoundationMigration,
  projectOpsSchemaSql,
  type ProjectOpsDashboardView,
  type ProjectRequest,
} from '../packages/projectops/src/index.ts';
import { createProjectOpsRoutes } from '../apps/api/src/projectops/routes.ts';
import { createProjectOpsRepositoryService } from '../apps/api/src/projectops/service.ts';
import { startHttpListener } from '../apps/api/src/bootstrap/http-listener.ts';

const T0 = '2026-09-29T08:00:00.000Z';
const T1 = '2026-09-29T09:00:00.000Z';

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

  const transitioned = await repo.transitionProjectRequest('req-1', 'estimated', T1);
  const clients = await repo.listClients();
  const fetchedClient = await repo.getClient('client-1');
  const requests = await repo.listProjectRequests();
  const fetchedRequest = await repo.getProjectRequest('req-1');
  const dashboard = await repo.getDashboard();
  const snapshot = sql.snapshot();

  assert.equal(transitioned.status, 'estimated');
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.id, 'client-1');
  assert.equal(fetchedClient?.name, 'Zad Studio');
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.id, 'req-1');
  assert.equal(fetchedRequest?.status, 'estimated');
  assert.equal(snapshot.projectRequests[0]?.status, 'estimated');
  assert.equal(dashboard.totalActiveRequests, 1);
  assert.equal(dashboard.byStatus.estimated, 1);
  assert.equal(dashboard.rows[0]?.clientName, 'Zad Studio');
});

unitTest('PROJECTOPS-PERSIST-004: API can run on repository-backed persistence service', async () => {
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
      `${server.origin}/projectops/project-requests/req-1/status`,
      { status: 'estimated' }
    );
    assert.equal(transitioned.status, 'estimated');

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
    assert.equal(((await requestRes.json()) as { status: string }).status, 'estimated');

    const missingRes = await fetch(`${server.origin}/projectops/project-requests/missing`);
    assert.equal(missingRes.status, 404);

    const dashboardRes = await fetch(`${server.origin}/projectops/dashboard`);
    assert.equal(dashboardRes.status, 200);
    const dashboard = await dashboardRes.json() as ProjectOpsDashboardView;

    assert.equal(dashboard.totalActiveRequests, 1);
    assert.equal(dashboard.byStatus.estimated, 1);
    assert.equal(sql.snapshot().projectRequests[0]?.status, 'estimated');
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
