import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium, type Page } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { openTab } from './workspace-ui.ts';

// Every page, at phone width and on a desktop, filled with the demo studio's data: nothing may
// scroll sideways (a phone user would have to pan to read or reach a control), and axe finds no
// WCAG 2.1 A/AA violation. axe runs in the page from the installed axe-core, not from a CDN.
const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const PHONE = { width: 390, height: 844 }, DESKTOP = { width: 1440, height: 900 };
type Violation = { id: string; impact: string; help: string; nodes: { target: string[]; any: { message: string }[] }[] };

async function audit(page: Page, label: string, problems: string[]) {
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > width + 1 && getComputedStyle(element).position !== 'fixed'; })
      // Report the outermost offenders only: a wide table, not every cell inside it.
      .filter((element, _, all) => !all.some(other => other !== element && other.contains(element)))
      .map(element => `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''} (${Math.round(element.getBoundingClientRect().right)}px)`);
    return { scroll: document.documentElement.scrollWidth, width, wide: wide.slice(0, 5) };
  });
  if (overflow.scroll > overflow.width) problems.push(`${label}: page is ${overflow.scroll}px wide in a ${overflow.width}px viewport: ${overflow.wide.join(', ')}`);
  // Evaluated through the browser's debugging protocol: the page's CSP (script-src 'self') stays on.
  if (!await page.evaluate(() => 'axe' in window)) await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: unknown[] }> } })
      .axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return result.violations;
  }) as Violation[];
  for (const violation of violations) problems.push(`${label}: ${violation.id} (${violation.impact}) ${violation.help}: ${violation.nodes.slice(0, 3).map(node => node.target.join(' ') + ' => ' + node.any.map(check => check.message).join('; ')).join(' | ')}${violation.nodes.length > 3 ? ` and ${violation.nodes.length - 3} more` : ''}`);
}

test('Every page fits a phone screen without sideways scrolling and passes an automated WCAG 2.1 AA check', async () => {
  await operatorFixture(async (databaseUrl) => {
    // Launch first: if the browser cannot start, no server is left running to keep the test open.
    const browser = await chromium.launch({ headless: true });
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, demo: true }).catch(async error => { await browser.close(); throw error; });
    const problems: string[] = [];
    try {
      for (const [device, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
        const context = await browser.newContext({ viewport, ...(device === 'phone' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
        const page = await context.newPage(); const origin = app.server.origin;
        await page.goto(origin + '/projectops/login'); await page.getByRole('button', { name: 'Explore the demo', exact: true }).waitFor();
        await audit(page, `${device} sign-in`, problems);
        await page.getByRole('button', { name: 'Explore the demo', exact: true }).click(); await page.waitForURL(origin + '/projectops');
        await page.locator('#demo-banner').waitFor();
        await audit(page, `${device} dashboard`, problems);
        await page.goto(origin + '/projectops/client-management'); await page.getByRole('link', { name: 'Harbor & Finch Bakery' }).first().waitFor();
        await audit(page, `${device} clients`, problems);
        await page.getByRole('link', { name: 'Harbor & Finch Bakery' }).first().click(); await page.getByRole('heading', { name: 'Harbor & Finch Bakery' }).waitFor();
        await audit(page, `${device} client`, problems);
        await page.goto(origin + '/projectops/projects/bakery-ordering');
        await page.getByRole('heading', { name: 'Online ordering for Harbor & Finch', exact: true }).waitFor();
        // Every tab is on screen without scrolling the tab bar.
        const hidden = await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link').evaluateAll(links => links
          .filter(link => { const box = link.getBoundingClientRect(), bar = link.parentElement!.getBoundingClientRect(); return box.left < bar.left - 1 || box.right > bar.right + 1; })
          .map(link => link.textContent));
        if (hidden.length) problems.push(`${device} workspace: tabs out of view: ${hidden.join(', ')}`);
        for (const tab of ['Overview', 'Plan', 'Work', 'Delivery', 'Money'] as const) {
          await openTab(page, tab);
          await audit(page, `${device} workspace ${tab}`, problems);
        }
        // An open create form and record editor are part of the page a user sees.
        await openTab(page, 'Plan');
        await page.locator('details.ws-create > summary').first().click();
        await audit(page, `${device} workspace Plan with New task open`, problems);
        await page.goto(origin + '/projectops/settings'); await page.locator('#defaults button:enabled').first().waitFor();
        await audit(page, `${device} settings`, problems);
        await context.close();
      }
      assert.deepEqual(problems, []);
    } finally { await browser.close(); await app.close(); }
  });
});
