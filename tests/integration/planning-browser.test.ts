import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { openTab, reveal } from './workspace-ui.ts';

test('Planning browser journey creates, edits, reschedules, completes, reopens and preserves read-only records', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, clock: () => '2026-10-03T12:00:00.000Z' });
    await new ProjectOpsOperatorStore(pool).provision('operator', 'planning-browser-password');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(); const page = await context.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.server.origin + '/projectops/login');
      await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('planning-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');
      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(response => response.json());
      const send = async (path: string, data: unknown) => {
        const response = await context.request.post(app.server.origin + '/projectops/' + path, { headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data });
        assert.equal(response.status(), 200, await response.text()); return response.json();
      };
      const read = (path: string) => context.request.get(app.server.origin + '/projectops/' + path).then(response => response.json());

      await send('clients', { id: 'planning-client', name: 'Planning client' });
      await send('project-requests', { id: 'planning-project', clientId: 'planning-client', title: 'Planning project', brief: 'Brief' });
      await send('project-requests/planning-project/estimate', { amountCents: 10000, currency: 'USD' });
      await send('project-requests/planning-project/approve', { approvedBy: 'operator' });
      await page.goto(app.server.origin + '/projectops/projects/planning-project');
      await page.getByRole('heading', { name: 'Planning project', exact: true }).waitFor();

      await reveal(page, '#create-milestone'); const milestoneCreate = page.locator('#create-milestone');
      await milestoneCreate.getByLabel('Milestone title').fill('Invalid milestone');
      await milestoneCreate.getByLabel('Milestone due (UTC)').fill('2020-01-01T00:00');
      await milestoneCreate.getByRole('button', { name: 'Create milestone', exact: true }).click();
      await page.locator('#milestone-planning-status').getByText(/must not be earlier/).waitFor();
      await milestoneCreate.getByLabel('Milestone title').fill('<b>Release milestone</b>');
      await milestoneCreate.getByLabel('Milestone due (UTC)').fill('2026-10-05T12:00');
      await milestoneCreate.getByRole('button', { name: 'Create milestone', exact: true }).click();
      await page.locator('#milestones').getByText('<b>Release milestone</b>', { exact: true }).waitFor();
      assert.equal(await page.locator('#milestones b').count(), 0);

      await reveal(page, '#create-task'); const taskCreate = page.locator('#create-task');
      await taskCreate.getByLabel('Task title').fill('Initial task');
      await taskCreate.getByLabel('Task description').fill('<img src=x onerror=alert(1)> details');
      await taskCreate.getByLabel('Task assignee').fill('Operator');
      await taskCreate.getByLabel('Task priority').selectOption('high');
      await taskCreate.getByLabel('Task due (UTC)').fill('2026-10-05T12:00');
      await taskCreate.getByRole('button', { name: 'Create task', exact: true }).click();
      await page.locator('#tasks').getByText('Initial task', { exact: true }).waitFor();
      assert.equal(await page.locator('#tasks img').count(), 0);

      let milestone = page.locator('#records-milestones article').filter({ hasText: '<b>Release milestone</b>' });
      await milestone.getByText('Edit milestone', { exact: true }).click();
      await milestone.getByLabel('Edit milestone title').fill('Edited milestone');
      await milestone.getByLabel('Edit milestone due (UTC)').fill('2026-10-06T12:00');
      await milestone.getByRole('button', { name: 'Save milestone', exact: true }).click();
      milestone = page.locator('#records-milestones article').filter({ hasText: 'Edited milestone' }); await milestone.waitFor();
      await milestone.getByText('Edit milestone', { exact: true }).click(); await milestone.getByLabel('Edit milestone due (UTC)').fill('');
      await milestone.getByRole('button', { name: 'Save milestone', exact: true }).click();
      await page.locator('#milestone-planning-status').getByText('Milestone saved.', { exact: true }).waitFor();

      let task = page.locator('#records-tasks article').filter({ hasText: 'Initial task' });
      await task.getByText('Edit task', { exact: true }).click();
      await task.getByLabel('Edit task title').fill('Edited task');
      await task.getByLabel('Edit task description').fill('Changed details');
      await task.getByLabel('Edit task assignee').fill('Planner');
      await task.getByLabel('Edit task priority').selectOption('low');
      await task.getByLabel('Edit task due (UTC)').fill('2026-10-06T12:00');
      await task.getByRole('button', { name: 'Save task', exact: true }).click();
      task = page.locator('#records-tasks article').filter({ hasText: 'Edited task' }); await task.waitFor();
      await task.getByText('Edit task', { exact: true }).click(); await task.getByLabel('Edit task description').fill(''); await task.getByLabel('Edit task assignee').fill(''); await task.getByLabel('Edit task due (UTC)').fill('');
      await task.getByRole('button', { name: 'Save task', exact: true }).click();
      await page.locator('#task-planning-status').getByText('Task saved.', { exact: true }).waitFor();

      const stale = await context.newPage(); stale.on('pageerror', error => errors.push(error.message)); await stale.goto(page.url());
      const staleTask = stale.locator('#records-tasks article').filter({ hasText: 'Edited task' }); await staleTask.waitFor();
      task = page.locator('#records-tasks article').filter({ hasText: 'Edited task' }); await task.getByText('Edit task', { exact: true }).click(); await task.getByLabel('Edit task title').fill('Fresh task');
      await task.getByRole('button', { name: 'Save task', exact: true }).click(); await page.locator('#tasks').getByText('Fresh task', { exact: true }).waitFor();
      await staleTask.getByText('Edit task', { exact: true }).click(); await staleTask.getByLabel('Edit task title').fill('Stale task'); await staleTask.getByRole('button', { name: 'Save task', exact: true }).click();
      await stale.locator('#task-planning-status').getByText(/Task changed/).waitFor(); assert.equal(await stale.getByRole('button', { name: 'Reload project', exact: true }).isVisible(), true); await stale.close();

      milestone = page.locator('#records-milestones article').filter({ hasText: 'Edited milestone' }); await milestone.getByRole('button', { name: 'Complete milestone', exact: true }).click();
      await page.locator('#milestone-planning-status').getByText('Completed.', { exact: true }).waitFor();
      milestone = page.locator('#records-milestones article').filter({ hasText: 'Edited milestone' }); await milestone.getByRole('button', { name: 'Reopen milestone', exact: true }).click();
      await page.locator('#milestone-planning-status').getByText('Reopened.', { exact: true }).waitFor();
      task = page.locator('#records-tasks article').filter({ hasText: 'Fresh task' }); await task.getByRole('button', { name: 'Complete task', exact: true }).click();
      await page.locator('#task-planning-status').getByText('Completed.', { exact: true }).waitFor();
      task = page.locator('#records-tasks article').filter({ hasText: 'Fresh task' }); await task.getByRole('button', { name: 'Reopen task', exact: true }).click();
      await page.locator('#task-planning-status').getByText('Reopened.', { exact: true }).waitFor();

      await page.reload(); await page.locator('#milestones').getByText('Edited milestone', { exact: true }).waitFor(); await page.locator('#tasks').getByText('Fresh task', { exact: true }).waitFor();
      assert.equal(await page.locator('#records-milestones article').filter({ hasText: 'Edited milestone' }).getByText('Due', { exact: true }).count(), 0);
      const savedTasks = await read('project-requests/planning-project/tasks'); const savedTask = savedTasks.find((value: { title: string }) => value.title === 'Fresh task');
      assert.equal(savedTask.status, 'open'); assert.equal(savedTask.completedBy, undefined); assert.equal(savedTask.dueAtIso, undefined);

      let project = await read('project-requests/planning-project'); project = await send('project-requests/planning-project/control', { action: 'start', expectedRevision: project.revision }); project = await send('project-requests/planning-project/control', { action: 'hold', expectedRevision: project.revision });
      await page.reload(); await page.locator('#milestones').getByText('Edited milestone', { exact: true }).waitFor();
      assert.equal(await page.locator('#create-milestone').isVisible(), false); assert.equal(await page.locator('#milestones .planning-edit').count(), 0); assert.equal(await page.getByRole('button', { name: 'Complete milestone', exact: true }).count(), 1);
      assert.equal(await page.locator('#tasks').getByText('New task', { exact: true }).isVisible(), true); assert.equal(await page.locator('#tasks .planning-edit').count(), 1);

      project = await send('project-requests/planning-project/control', { action: 'cancel', expectedRevision: project.revision }); assert.equal(project.status, 'cancelled');
      await page.reload(); await openTab(page, 'Overview'); await page.getByText('Cancelled projects are read-only.', { exact: true }).waitFor(); await openTab(page, 'Plan');
      await page.locator('#milestones').getByText('Edited milestone', { exact: true }).waitFor(); await page.locator('#tasks').getByText('Fresh task', { exact: true }).waitFor();
      assert.equal(await page.locator('#milestones form,#tasks form').count(), 2); // hidden create forms remain in the document
      assert.equal(await page.locator('#milestones form:visible,#tasks form:visible').count(), 0);
      assert.equal(await page.locator('#milestones .planning-actions,#tasks .planning-actions').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
  });
});
