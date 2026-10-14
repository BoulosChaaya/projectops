import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';

test('Client directory shows the first 50 clients, loads the rest on demand and restarts paging on a new search', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    let tick = 0;
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0,
      clock: () => new Date(Date.UTC(2026, 9, 3, 10, 0) + Math.floor(tick++ / 5) * 60_000).toISOString() });
    let browser;
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'pagination-browser-password');
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext(); const page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.server.origin + '/projectops/login');
      await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('pagination-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');

      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(response => response.json());
      for (let i = 0; i < 55; i++) {
        const response = await context.request.post(app.server.origin + '/projectops/clients', {
          headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data: { id: `client-${String(i).padStart(2, '0')}`, name: `Studio ${i}` } });
        assert.equal(response.status(), 200);
      }
      await context.request.post(app.server.origin + '/projectops/clients/client-00/archive', {
        headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data: { expectedRevision: 1 } });

      await page.goto(app.server.origin + '/projectops/client-management');
      const rows = page.locator('#clients tr'); const more = page.getByRole('button', { name: 'Load more clients', exact: true });
      // The directory defaults to active clients: 54 of the 55.
      await page.locator('#count').getByText('Showing first 50 clients', { exact: true }).waitFor();
      assert.equal(await rows.count(), 50);
      assert.ok(await more.isVisible());

      await more.click();
      await page.locator('#count').getByText('54 clients', { exact: true }).waitFor();
      assert.equal(await rows.count(), 54);
      assert.equal(await more.isVisible(), false);
      const names = await rows.locator('a').allTextContents();
      assert.equal(new Set(names).size, 54, 'no client is shown twice across pages');
      assert.ok(!names.includes('Studio 0'), 'archived client is not listed');

      // A new search starts again from the first page instead of appending to the old results.
      await page.getByLabel('Search', { exact: true }).fill('Studio 4');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.locator('#count').getByText('11 clients', { exact: true }).waitFor();
      assert.deepEqual((await rows.locator('a').allTextContents()).sort(), ['Studio 4', ...Array.from({ length: 10 }, (_, i) => `Studio 4${i}`)].sort());
      assert.equal(await more.isVisible(), false);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close(); await app.close();
    }
  });
});
