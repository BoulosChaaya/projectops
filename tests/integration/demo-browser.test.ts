import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { openTab } from './workspace-ui.ts';

test('A visitor explores the demo from the sign-in page, works in a private copy, resets it and leaves', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, demo: true });
    const browser = await chromium.launch({ headless: true });
    const sandboxes = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM pg_namespace WHERE nspname ~ '^demo_[a-f0-9]{24}$'`)).rows[0].n);
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'demo-browser-password');
      const visitor = await browser.newContext(); const page = await visitor.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.server.origin + '/projectops/login');
      const offer = page.locator('#demo'); await offer.getByText(/private copy/).waitFor(); await offer.getByText(/deleted after 2 hours/).waitFor();
      await offer.getByRole('button', { name: 'Explore the demo', exact: true }).click();
      await page.waitForURL(app.server.origin + '/projectops');
      // Every page says it is a sandbox and when it goes.
      const banner = page.locator('#demo-banner'); await banner.getByText(/Demo sandbox\./).waitFor(); await banner.getByText(/deleted at/).waitFor();
      await page.getByRole('link', { name: 'Online ordering for Harbor & Finch', exact: true }).first().click();
      await page.getByRole('heading', { name: 'Online ordering for Harbor & Finch', exact: true }).waitFor();
      await page.locator('#demo-banner').waitFor();
      await openTab(page, 'Plan');
      const payments = page.locator('#records-tasks article').filter({ hasText: 'Card payments with the payment provider' });
      await payments.getByRole('button', { name: 'Complete task', exact: true }).click();
      await page.locator('#task-planning-status').getByText('Completed.', { exact: true }).waitFor();
      await page.locator('#records-activities article').filter({ hasText: 'Task completed' }).first().getByText(/^demo · /).waitFor();
      // Sign-in details are the owner's: not offered in the demo.
      await page.getByRole('link', { name: 'Settings', exact: true }).click(); await page.locator('#defaults button:enabled').first().waitFor();
      assert.equal(await page.locator('#credentials').count(), 0); await page.getByText(/cannot be changed from here/).waitFor();
      // Reset brings back the sample as it was.
      const reset = page.waitForResponse(response => response.url().endsWith('/projectops/demo/reset'));
      await page.getByRole('button', { name: 'Reset sample data', exact: true }).click(); assert.equal((await reset).status(), 200);
      await page.waitForLoadState('load'); await page.locator('#defaults button:enabled').first().waitFor();
      await page.goto(app.server.origin + '/projectops/projects/bakery-ordering?tab=plan');
      await page.locator('#records-tasks article').filter({ hasText: 'Card payments with the payment provider' }).getByRole('button', { name: 'Complete task', exact: true }).waitFor();
      assert.equal(await sandboxes(), 1);
      // Leaving deletes the sandbox and returns to sign-in.
      await page.getByRole('button', { name: 'Leave demo', exact: true }).click(); await page.waitForURL('**/projectops/login');
      assert.equal(await sandboxes(), 0);
      await page.goto(app.server.origin + '/projectops'); await page.waitForURL('**/projectops/login');

      // The owner, signed in meanwhile, never saw the sample studio.
      const owner = await (await browser.newContext()).newPage(); owner.on('pageerror', error => errors.push(error.message));
      await owner.goto(app.server.origin + '/projectops/login');
      await owner.getByLabel('Login', { exact: true }).fill('operator'); await owner.getByLabel('Password', { exact: true }).fill('demo-browser-password');
      await owner.getByRole('button', { name: 'Sign in', exact: true }).click(); await owner.waitForURL('**/projectops');
      await owner.getByText('No active project requests yet', { exact: false }).waitFor();
      assert.equal(await owner.locator('#demo-banner').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
  });
});

test('Without the demo switched on, the sign-in page offers no demo', async () => {
  await operatorFixture(async (databaseUrl) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const checked = page.waitForResponse(response => response.url().endsWith('/projectops/demo'));
      await page.goto(app.server.origin + '/projectops/login'); await checked;
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Explore the demo' }).count(), 0);
    } finally { await browser.close(); await app.close(); }
  });
});
