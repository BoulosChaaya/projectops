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
  assert.match(rendered.html, /Launch dashboard/);
  assert.match(rendered.html, /Zad Studio/);
  assert.match(rendered.html, /In Progress/);
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
  await repo.transitionProjectRequest('req-1', 'estimated', T1);

  const summary = await repo.getDashboard();
  const page = composeProjectOpsDashboardPageFromSummary(summary);
  const rendered = renderProjectOpsDashboardPage(page);

  assert.match(rendered.html, /Repository UI/);
  assert.match(rendered.html, /Zad Studio/);
  assert.match(rendered.html, /Estimated/);
  assert.match(rendered.html, /1 shown/);
});
