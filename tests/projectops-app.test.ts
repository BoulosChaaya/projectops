import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  ProjectOpsMemorySqlExecutor,
  type ProjectOpsDashboardView,
  type ProjectRequest,
} from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';

const T0 = '2026-09-29T08:00:00.000Z';

unitTest('PROJECTOPS-APP-001: composed app migrates storage and serves API plus web dashboard', async () => {
  const sql = new ProjectOpsMemorySqlExecutor();
  const app = await startProjectOpsApp({
    sql,
    port: 0,
    clock: () => T0,
  });

  try {
    assert.equal(app.routes.some((route) => route.path === '/projectops/dashboard'), true);
    assert.equal(app.routes.some((route) => route.path === '/projectops'), true);

    await postOk(`${app.server.origin}/projectops/clients`, {
      id: 'client-1',
      name: 'Zad Studio',
    });

    const created = await postOk<ProjectRequest>(
      `${app.server.origin}/projectops/project-requests`,
      {
        id: 'req-1',
        clientId: 'client-1',
        title: 'Composed ProjectOps app',
        brief: 'Prove one boot path exposes product API and web dashboard.',
        priority: 'high',
      }
    );
    assert.equal(created.status, 'new');

    const estimated = await postOk<ProjectRequest>(
      `${app.server.origin}/projectops/project-requests/req-1/status`,
      { status: 'estimated' }
    );
    assert.equal(estimated.status, 'estimated');

    const dashboardRes = await fetch(`${app.server.origin}/projectops/dashboard`);
    assert.equal(dashboardRes.status, 200);
    const dashboard = await dashboardRes.json() as ProjectOpsDashboardView;
    assert.equal(dashboard.totalActiveRequests, 1);
    assert.equal(dashboard.byStatus.estimated, 1);

    const webRes = await fetch(`${app.server.origin}/projectops`, {
      headers: { accept: 'text/html' },
    });
    const html = await webRes.text();
    assert.equal(webRes.status, 200);
    assert.equal(webRes.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(html, /Composed ProjectOps app/);
    assert.match(html, /Estimated/);

    assert.equal(sql.snapshot().projectRequests.length, 1);
  } finally {
    await app.close();
  }
});

async function postOk<T = unknown>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.equal(response.status, 200);
  return await response.json() as T;
}
