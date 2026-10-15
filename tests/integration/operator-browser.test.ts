import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';

test('Operator completes login, saved settings, credential change and logout in Chromium', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 });
    let browser;
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'browser-acceptance-password');
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(app.server.origin + '/projectops');
      assert.ok(page.url().endsWith('/projectops/login'));
      const signIn = async (login: string, password: string) => {
        await page.getByLabel('Login', { exact: true }).fill(login);
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      };
      await signIn('operator', 'incorrect-password');
      await page.getByRole('status').filter({ hasText: 'Invalid login or password.' }).waitFor();
      await signIn('operator', 'browser-acceptance-password');
      await page.waitForURL('**/projectops');
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('[name="defaultCurrency"]') as HTMLInputElement)?.value === 'USD');
      await page.getByLabel('Currency', { exact: true }).fill('EUR');
      await page.getByLabel('Priority', { exact: true }).selectOption('high');
      await page.getByLabel('Timezone', { exact: true }).fill('Asia/Beirut');
      await page.getByRole('button', { name: 'Save defaults' }).click();
      await page.getByRole('status').filter({ hasText: 'Defaults saved.' }).waitFor();
      await page.reload();
      await page.waitForFunction(() => (document.querySelector('[name="defaultCurrency"]') as HTMLInputElement)?.value === 'EUR');
      assert.equal(await page.getByLabel('Priority', { exact: true }).inputValue(), 'high');
      await page.getByLabel('Login', { exact: true }).fill('updated');
      await page.getByLabel('Current password').fill('browser-acceptance-password');
      await page.getByLabel('New password').fill('changed-browser-password');
      await page.getByRole('button', { name: 'Change credentials' }).click();
      await page.waitForURL('**/projectops/login');
      await signIn('updated', 'changed-browser-password');
      await page.waitForURL('**/projectops');
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL('**/projectops/login');
      await page.goto(app.server.origin + '/projectops/settings');
      assert.ok(page.url().endsWith('/projectops/login'));
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); await app.close(); }
  });
});
