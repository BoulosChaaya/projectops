import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openTab } from './workspace-ui.ts';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
test('Browser estimates, confirmed lifecycle decisions, stale tabs and cancelled history', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 }); let browser;
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'controls-browser-password');
      browser = await chromium.launch({ headless: true }); const context = await browser.newContext(); const page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(app.server.origin + '/projectops/login'); await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('controls-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');
      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(r => r.json());
      const send = async (path: string, data: unknown) => { const r = await context.request.post(app.server.origin + '/projectops/' + path, { headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data }); assert.equal(r.status(), 200, await r.text()); return r.json(); };
      const read = (id: string) => context.request.get(app.server.origin + '/projectops/project-requests/' + id).then(r => r.json());
      await send('access/settings', { defaultCurrency: 'EUR', defaultPriority: 'medium', timezone: 'UTC' });
      await send('clients', { id: 'c', name: 'Controls client' });
      for (const id of ['r', 'cancel']) await send('project-requests', { id, clientId: 'c', title: 'Controls ' + id, brief: 'Brief' });
      await page.goto(app.server.origin + '/projectops/projects/r'); await page.getByRole('heading', { name: 'Controls r', exact: true }).waitFor();
      const form = page.locator('#estimate-form'); assert.equal(await form.getByLabel('Estimate currency', { exact: true }).inputValue(), 'EUR');
      await form.getByLabel('Estimate amount (currency units)', { exact: true }).fill('123.45'); await form.getByRole('button', { name: 'Save estimate', exact: true }).click();
      await page.locator('#message').filter({ hasText: 'Estimate saved.' }).waitFor(); assert.equal((await read('r')).estimateAmountCents, 12345);
      const stale = await context.newPage(); stale.on('pageerror', e => errors.push(e.message)); await stale.goto(page.url()); await stale.getByRole('button', { name: 'Approve estimate', exact: true }).waitFor();
      await stale.getByRole('button', { name: 'Approve estimate', exact: true }).click();
      await form.getByLabel('Estimate amount (currency units)', { exact: true }).fill('150.01'); await form.getByRole('button', { name: 'Save estimate', exact: true }).click();
      await page.locator('#message').filter({ hasText: 'Estimate saved.' }).waitFor();
      await stale.getByRole('button', { name: 'Confirm approval', exact: true }).click(); await stale.locator('#message').filter({ hasText: 'Reload before trying again.' }).waitFor();
      assert.equal((await read('r')).status, 'estimated'); await stale.getByRole('button', { name: 'Reload project', exact: true }).click();
      await stale.locator('#estimate-form input[name=amount]').filter({ visible: true }).waitFor(); await stale.close();
      const action = async (button: string, confirmation: string, feedback: string) => {
        await page.getByRole('button', { name: button, exact: true }).click(); await page.getByRole('button', { name: confirmation, exact: true }).click(); await page.locator('#message').filter({ hasText: feedback }).waitFor();
      };
      await page.getByRole('button', { name: 'Approve estimate', exact: true }).click(); await page.getByRole('button', { name: 'Keep current state', exact: true }).click(); assert.equal((await read('r')).status, 'estimated');
      await action('Approve estimate', 'Confirm approval', 'Estimate approved.'); assert.equal((await read('r')).approvedBy, 'operator'); assert.equal(await form.isVisible(), false);
      await send('project-requests/r/deliverables', { id: 'delivery', title: 'Delivery', artifactUrl: 'https://example.test/artifact' });
      await send('project-requests/r/deliverables/delivery/accept', {});
      await action('Start project', 'Confirm start', 'Project started.');
      await action('Hold project', 'Confirm hold', 'Project placed on hold.'); assert.equal(await page.getByRole('button', { name: 'Mark delivered', exact: true }).count(), 0);
      await page.reload(); await page.getByRole('button', { name: 'Resume project', exact: true }).waitFor();
      await action('Resume project', 'Confirm resume', 'Project resumed.'); await action('Mark delivered', 'Confirm delivery', 'Project marked delivered.'); await action('Archive project', 'Confirm archive', 'Project archived.');
      await page.getByText('Archived projects are read-only.', { exact: true }).waitFor(); assert.equal(await page.locator('#control-actions button').count(), 0);
      await send('project-requests/cancel/notes', { id: 'n', author: 'Operator', body: 'Retained after cancellation' });
      await page.goto(app.server.origin + '/projectops/projects/cancel'); await page.getByRole('heading', { name: 'Controls cancel', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancel project', exact: true }).click(); await page.getByRole('button', { name: 'Keep current state', exact: true }).click(); assert.equal((await read('cancel')).status, 'new');
      await action('Cancel project', 'Confirm cancellation', 'Project cancelled.'); await page.getByText('Cancelled projects are read-only.', { exact: true }).waitFor();
      await openTab(page, 'Work'); await page.locator('#notes').getByText('Retained after cancellation', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Save project', exact: true }).isVisible(), false);
      await page.getByRole('link', { name: 'Dashboard', exact: true }).click(); assert.equal(await page.getByRole('link', { name: 'Controls cancel', exact: true }).count(), 0);
      await page.goto(app.server.origin + '/projectops/client-management/c'); await page.getByRole('link', { name: 'Controls cancel', exact: true }).click(); await page.getByText('Cancelled projects are read-only.', { exact: true }).waitFor();
      await action('Archive project', 'Confirm archive', 'Project archived.'); assert.equal((await read('cancel')).status, 'archived'); assert.deepEqual(errors, []);
    } finally { await browser?.close(); await app.close(); }
  });
});
