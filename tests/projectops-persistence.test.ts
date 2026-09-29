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
  const dashboard = await repo.getDashboard();
  const snapshot = sql.snapshot();

  assert.equal(transitioned.status, 'estimated');
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
