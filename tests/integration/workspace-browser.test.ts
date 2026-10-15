import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { projectSections, workspaceTabs } from '../../apps/client/src/pages/project/sections.ts';
import { openTab, reveal } from './workspace-ui.ts';

test('Project browser journey creates, navigates every section, edits safely, retries failures and preserves archived views', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    // Pinned before the 2026-11-01/2026-12-01 deadlines entered below; the wall clock would reject them once it passes them.
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, clock: () => '2026-10-03T12:00:00.000Z' }); let browser;
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'workspace-browser-password');
      browser = await chromium.launch({ headless: true }); const context = await browser.newContext(); const page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(app.server.origin + '/projectops/projects/missing'); assert.ok(page.url().endsWith('/projectops/login'));
      await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('workspace-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');
      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(r => r.json());
      const send = async (path: string, data: unknown) => {
        const r = await context.request.post(app.server.origin + '/projectops/' + path, { headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data });
        assert.equal(r.status(), 200, await r.text()); return await r.json();
      };
      await send('access/settings', { defaultCurrency: 'EUR', defaultPriority: 'high', timezone: 'Asia/Beirut' });
      await send('clients', { id: 'workspace-client', name: 'Workspace client' });
      await page.goto(app.server.origin + '/projectops/client-management/workspace-client');
      await page.locator('#create-project button:enabled').first().waitFor();
      const create = page.locator('#create-project'); assert.equal(await create.getByLabel('Priority', { exact: true }).inputValue(), 'high');
      await create.getByLabel('Project title').fill('Project_one'); await create.getByLabel('Brief', { exact: true }).fill('<img src=x onerror=alert(1)> brief_one');
      await create.getByLabel('Budget range').fill('USD 100-200'); await create.getByLabel('Deadline (UTC)').fill('2026-11-01T12:00');
      await create.getByRole('button', { name: 'Create project', exact: true }).click(); await page.waitForURL('**/projects/*');
      await page.getByRole('heading', { name: 'Project_one', exact: true }).waitFor();
      assert.equal(await page.locator('#budget').textContent(), 'USD 100-200'); assert.equal(await page.locator('#brief').textContent(), '<img src=x onerror=alert(1)> brief_one');
      assert.equal(await page.locator('#brief img').count(), 0); assert.match((await page.locator('#deadline').textContent())!, /Asia\/Beirut/);
      const projectId = new URL(page.url()).pathname.split('/').at(-1)!; const root = 'project-requests/' + projectId;
      await openTab(page, 'Plan'); await page.getByText('No tasks recorded.', { exact: true }).waitFor();
      await send(root + '/estimate', { amountCents: 10000, currency: 'EUR' }); await send(root + '/approve', { approvedBy: 'Operator' });
      const fixtures = [
        ['milestones', { id: 'm', title: 'Workspace milestone' }], ['tasks', { id: 't', title: 'Workspace task' }],
        ['work-logs', { id: 'w', actor: 'Operator', minutes: 30, note: 'Workspace work' }],
        ['notes', { id: 'n', author: 'Operator', body: 'Workspace_note' }],
        ['documents', { id: 'd', title: 'Workspace document', url: 'https://example.com/document', uploadedBy: 'Operator' }],
        ['issues', { id: 'i', title: 'Workspace issue', description: 'Issue details' }],
        ['risks', { id: 'risk', title: 'Workspace risk', description: 'Risk details' }],
        ['deliverables', { id: 'delivery', title: 'Workspace delivery', artifactUrl: 'https://example.com/delivery' }],
        ['feedback', { id: 'f', author: 'Reviewer', message: 'Workspace feedback' }],
        ['invoices', { id: 'inv', invoiceNumber: 'WS-001', amountCents: 2000, currency: 'EUR' }],
        ['expenses', { id: 'e', description: 'Workspace expense', amountCents: 1000, currency: 'USD' }],
        ['change-requests', { id: 'cr', title: 'Workspace change', description: 'Change details', requestedBy: 'Operator' }],
        ['activities', { summary: 'Workspace history' }],
      ] as const;
      for (const [path, data] of fixtures) await send(root + '/' + path, data);
      let failed = false;
      await page.route('**/project-requests/*/issues', async route => {
        if (!failed && route.request().method() === 'GET') { failed = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary failure' }) }); }
        else await route.continue();
      });
      await page.reload(); await openTab(page, 'Work'); await page.getByRole('button', { name: 'Retry issues', exact: true }).click(); await page.locator('#issues').getByText('Workspace issue', { exact: true }).waitFor();
      // Every record section is reachable: on its tab, or (history) in the rail beside every tab.
      assert.deepEqual([...workspaceTabs.flatMap(tab => tab.sections), 'activities'].sort(), projectSections.map(section => section.path).sort());
      for (const tab of workspaceTabs) {
        await openTab(page, tab.label);
        for (const path of tab.sections) await page.locator('#records-' + path + ' article').first().waitFor();
        await page.locator('#records-activities article').first().waitFor();
      }
      await openTab(page, 'Work');
      assert.equal(await page.locator('#notes dd').filter({ hasText: 'Workspace_note' }).textContent(), 'Workspace_note');
      assert.equal(await page.locator('#documents').getByRole('link').getAttribute('rel'), 'noopener noreferrer');
      await openTab(page, 'Money'); await page.locator('#invoices').getByText('20.00 EUR', { exact: true }).waitFor();
      const stale = await context.newPage(); stale.on('pageerror', e => errors.push(e.message)); await stale.goto(page.url().split('?')[0]);
      await reveal(stale, '#edit-project'); await stale.getByRole('button', { name: 'Save project', exact: true }).waitFor();
      await reveal(page, '#edit-project'); const edit = page.locator('#edit-project'); await edit.getByLabel('Project title').fill('Edited project'); await edit.getByLabel('Brief', { exact: true }).fill('Edited brief');
      await edit.getByLabel('Budget range').fill('EUR 500-1000'); await edit.getByLabel('Priority', { exact: true }).selectOption('medium'); await edit.getByLabel('Deadline (UTC)').fill('2026-12-01T13:00');
      await edit.getByRole('button', { name: 'Save project', exact: true }).click(); await page.locator('#message').filter({ hasText: 'Project saved.' }).waitFor();
      await stale.locator('#edit-project').getByLabel('Brief', { exact: true }).fill('Stale brief'); await stale.getByRole('button', { name: 'Save project', exact: true }).click();
      await stale.locator('#message').filter({ hasText: 'Reload before trying again.' }).waitFor(); await stale.getByRole('button', { name: 'Reload project', exact: true }).click();
      await stale.getByRole('heading', { name: 'Edited project', exact: true }).waitFor(); await stale.close();
      await page.reload(); await page.getByRole('heading', { name: 'Edited project', exact: true }).waitFor(); await reveal(page, '#edit-project');
      assert.equal(await edit.getByLabel('Budget range').inputValue(), 'EUR 500-1000'); assert.equal(await edit.getByLabel('Priority', { exact: true }).inputValue(), 'medium');
      assert.equal(await edit.getByLabel('Deadline (UTC)').inputValue(), '2026-12-01T13:00');
      await edit.getByLabel('Budget range').fill(''); await edit.getByLabel('Deadline (UTC)').fill(''); await edit.getByRole('button', { name: 'Save project', exact: true }).click();
      await page.locator('#message').filter({ hasText: 'Project saved.' }).waitFor(); await page.locator('#deadline').getByText('No deadline', { exact: true }).waitFor();
      await page.getByRole('link', { name: 'Dashboard', exact: true }).click(); await page.getByRole('link', { name: 'Edited project', exact: true }).click();
      await page.getByRole('heading', { name: 'Edited project', exact: true }).waitFor();
      await send(root + '/deliverables/delivery/accept', {});
      await send(root + '/feedback/f/address', { addressedBy: 'operator' });
      for (const status of ['in_progress', 'delivered', 'archived']) await send(root + '/status', { status });
      await page.reload(); await page.getByText('Archived projects are read-only.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save project', exact: true }).isVisible(), false);
      await openTab(page, 'Work'); await page.locator('#notes').getByText('Workspace_note', { exact: true }).waitFor();
      await page.getByRole('link', { name: 'Workspace client', exact: true }).click(); await page.getByRole('link', { name: 'Edited project', exact: true }).click();
      await page.getByText('Archived projects are read-only.', { exact: true }).waitFor();
      // A link to a section without a tab (bookmarks from before tabs) opens the tab that shows it.
      await page.goto(app.server.origin + '/projectops/projects/' + projectId + '#invoices'); await page.locator('.ws-tabs a[aria-current="page"]').filter({ hasText: 'Money' }).waitFor();
      await page.locator('#invoices').getByText('20.00 EUR', { exact: true }).waitFor();
      await page.goto(app.server.origin + '/projectops/projects/missing'); await page.locator('#project-status').getByText('Project not found.', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await app.close(); }
  });
});
