import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { ProjectOpsRepository, ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection } from '../../packages/projectops/src/index.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { startProjectOpsApp } from '../../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../../apps/api/src/projectops/access.ts';
import { seedDashboard, NOW } from '../dashboard-fixture.ts';

test('Operational dashboard Chromium journey searches, filters, navigates, retries and displays timezone-safe exact operational data without writes', async () => {
  await operatorFixture(async (_url, pool) => {
    const client = await pool.connect();
    try { await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations()); } finally { client.release(); }
    const sql = new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool));
    const base = new ProjectOpsRepository(sql);
    const store = new ProjectOpsOperatorStore(pool);
    await store.provision('operator', 'dashboard-browser-password');
    await store.saveDefaults({ defaultCurrency: 'GBP', defaultPriority: 'medium', timezone: 'Asia/Beirut' });
    let unavailable = false;
    const app = await startProjectOpsApp({
      sql: { transaction: run => sql.transaction(run), query: async statement => {
        if (unavailable && statement.sql.includes('WITH dashboard_scope')) throw Error('Private failure');
        return sql.query(statement);
      } },
      clock: () => NOW, access: new ProjectOpsAccess(store), host: '127.0.0.1', port: 0,
    });
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      // The browser is in Los Angeles; the operator's saved timezone is Beirut. Dates must follow the operator.
      const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
      const page = await context.newPage();
      const errors: string[] = [], writes: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });

      await page.goto(app.server.origin + '/projectops');
      await page.getByLabel('Login', { exact: true }).fill('operator');
      await page.getByLabel('Password', { exact: true }).fill('dashboard-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL('**/projectops');
      await page.getByText('No active project requests yet', { exact: true }).waitFor();
      for (const empty of ['No overdue work.', 'No upcoming deadlines.', 'No outstanding invoices.']) await page.getByText(empty, { exact: true }).waitFor();

      let tick = 0;
      await seedDashboard(base.withHistory({ actor: 'operator', clock: () => new Date(Date.parse(NOW) + tick++).toISOString() }));
      const snapshot = async () => ({
        projects: (await pool.query('SELECT row_to_json(p) AS row FROM projectops_project_requests p ORDER BY id')).rows,
        activities: (await pool.query('SELECT row_to_json(a) AS row FROM projectops_project_activities a ORDER BY project_request_id,id')).rows,
      });
      const before = await snapshot();
      writes.length = 0;

      const scope = page.locator('.result-scope');
      const overdue = page.locator('#overdue'), upcoming = page.locator('#upcoming'), outstanding = page.locator('#outstanding');
      const text = async (locator: typeof overdue) => (await locator.textContent()) ?? '';
      await page.reload();
      await scope.getByText(/7 matching projects/).waitFor();
      assert.match(await text(scope), /Asia\/Beirut/);
      assert.match(await text(upcoming), /2:00 PM/, 'noon UTC is 14:00 in Beirut, whatever the browser or server timezone');
      // Stored text is shown as text: no injected elements, the markup visible as characters.
      const main = page.locator('main');
      assert.equal(await main.locator('img, script, b').count(), 0);
      await page.getByText('<b>Other</b>', { exact: true }).waitFor();
      await upcoming.getByText('<script>alert(1)</script> upcoming milestone', { exact: true }).first().waitFor();
      assert.match(await text(overdue), /14 overdue tasks and milestones/);
      assert.match(await text(outstanding), /16 issued invoices/);
      assert.match(await text(outstanding), /EUR 120,000,000\.00/);
      assert.match(await text(outstanding), /USD 1\.24/);
      assert.ok(!(await text(outstanding)).includes('GBP'), 'a currency with nothing owed is not listed');
      assert.equal(await page.locator('.pipeline li[data-status="on_hold"]').count(), 1);
      assert.ok(await page.locator('.metric').count() > 0);

      const apply = async (q: string, status = 'all') => {
        await page.getByLabel('Search projects').fill(q);
        await page.getByLabel('Status', { exact: true }).selectOption(status);
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await page.waitForLoadState('load');
      };
      await apply('Project approved', 'approved');
      assert.match(page.url(), /q=Project\+approved&status=approved/);
      await scope.getByText(/1 matching project in Approved/).waitFor();
      assert.match(await text(outstanding), /4 issued invoices/);
      assert.match(await text(outstanding), /EUR 30,000,000\.00/);
      assert.match(await text(overdue), /3 overdue tasks and milestones/);
      await page.reload();
      await scope.getByText(/1 matching project/).waitFor();
      assert.equal(await page.getByLabel('Search projects').inputValue(), 'project approved');
      assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), 'approved');

      await apply('Studio', 'on_hold');
      await scope.getByText(/1 matching project in On hold/).waitFor();
      await page.getByRole('link', { name: 'Reset', exact: true }).click();
      await page.waitForURL(app.server.origin + '/projectops');
      await scope.getByText(/7 matching projects/).waitFor();
      await page.goBack();
      await scope.getByText(/On hold/).waitFor();
      assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), 'on_hold');
      await page.goForward();
      await scope.getByText(/7 matching projects/).waitFor();

      // The pipeline filters by stage, keeping the search.
      await page.locator('.pipeline li[data-status="delivered"] a').click();
      await page.waitForURL(/status=delivered/);
      await scope.getByText(/1 matching project in Delivered/).waitFor();

      await apply('Project approved', 'delivered');
      await page.getByText('No matching projects', { exact: true }).waitFor();
      await page.getByText('No overdue work.', { exact: true }).waitFor();
      await page.getByText('No outstanding invoices.', { exact: true }).waitFor();

      await apply('', 'delivered');
      await scope.getByText(/1 matching project/).waitFor();
      assert.match(await text(overdue), /3 overdue tasks and milestones/);
      assert.match(await text(upcoming), /Milestone in Project delivered/);
      assert.ok(!(await text(upcoming)).includes('Project deadline'), 'a delivered project has no project deadline left');

      const planningLink = overdue.locator('li').filter({ hasText: 'Task in' }).first().getByRole('link');
      assert.equal(await planningLink.getAttribute('href'), '/projectops/projects/delivered#tasks');
      await planningLink.click();
      await page.locator('#tasks').getByText('<img src=x onerror=alert(1)> overdue task', { exact: true }).waitFor();

      await page.goto(app.server.origin + '/projectops?status=delivered');
      const financeLink = outstanding.getByRole('link', { name: 'Invoices for Project delivered', exact: true });
      assert.equal(await financeLink.getAttribute('href'), '/projectops/projects/delivered#invoices');
      await financeLink.click();
      await page.locator('#invoices').getByText('No date', { exact: true }).waitFor();

      for (const state of ['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered']) {
        await page.goto(app.server.origin + '/projectops?status=' + state);
        await page.locator('.requests-table').getByRole('link', { name: 'Project ' + state, exact: true }).waitFor();
        assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), state);
      }

      await page.goto(app.server.origin + '/projectops?status=new&q=%3Cb%3EOther%3C%2Fb%3E');
      for (const empty of ['No overdue work.', 'No upcoming deadlines.', 'No outstanding invoices.']) await page.getByText(empty, { exact: true }).waitFor();
      assert.equal(await main.locator('b').count(), 0);

      // A failed read shows no figures at all, never zeros that look authoritative, and retries the same filter.
      unavailable = true;
      await page.goto(app.server.origin + '/projectops?q=studio&status=on_hold');
      await page.getByText('Dashboard unavailable. No current metrics could be loaded.', { exact: true }).waitFor();
      assert.equal(await page.locator('.metric').count(), 0);
      assert.equal(await page.locator('.pipeline').count(), 0);
      const retry = page.getByRole('link', { name: 'Retry dashboard', exact: true });
      assert.equal(await retry.getAttribute('href'), '/projectops?q=studio&status=on_hold');
      unavailable = false;
      await retry.click();
      await scope.getByText(/1 matching project/).waitFor();
      assert.equal(await page.getByLabel('Status', { exact: true }).inputValue(), 'on_hold');

      // An invalid filter explains itself and offers a way back.
      await page.goto(app.server.origin + '/projectops?status=archived');
      await page.getByRole('alert').getByRole('link', { name: 'Reset filters', exact: true }).waitFor();

      await page.goto(app.server.origin + '/projectops');
      await scope.getByText(/7 matching projects/).waitFor();
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways page scroll on a phone');
      await page.getByRole('button', { name: 'Apply', exact: true }).waitFor();

      assert.deepEqual(await snapshot(), before, 'the dashboard never writes');
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await app.close(); }
  });
});
