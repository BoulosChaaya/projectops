import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { reveal } from './workspace-ui.ts';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';

test('Protected delivery journey submits, accepts, addresses and enforces delivery and archival readiness', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 }); let browser;
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'delivery-browser-password');
      browser = await chromium.launch({ headless: true }); const context = await browser.newContext(), page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.server.origin + '/projectops/login'); await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('delivery-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');
      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(r => r.json());
      const send = async (path: string, data: unknown) => { const r = await context.request.post(app.server.origin + '/projectops/' + path, { headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data }); assert.equal(r.status(), 200, await r.text()); return r.json(); };
      const read = (path: string) => context.request.get(app.server.origin + '/projectops/' + path).then(r => r.json());
      const root = 'project-requests/r';
      await send('clients', { id: 'c', name: 'Delivery client' }); await send('project-requests', { id: 'r', clientId: 'c', title: 'Delivery project', brief: 'Brief' });
      // A create form is offered when its "New …" control is shown (the form opens from it).
      const offered = (selector: string) => page.locator('details.ws-create:has(' + selector + ') > summary').isVisible();
      const visit = async (id = 'r') => { await page.goto(app.server.origin + '/projectops/projects/' + id + '?tab=delivery'); await page.locator('#delivery-readiness-status').filter({ hasText: /Blocked:|Ready:/ }).waitFor(); };
      await visit(); assert.equal(await offered('#create-deliverable'), false); assert.equal(await offered('#create-feedback'), false);
      await send(root + '/estimate', { amountCents: 100 }); await send(root + '/approve', { approvedBy: 'operator' }); await send(root + '/milestones', { id: 'm', title: 'Open milestone' });
      await visit(); assert.equal(await offered('#create-deliverable'), true); assert.equal(await offered('#create-feedback'), true);
      const action = async (button: string, confirmation: string, outcome: RegExp) => {
        await page.getByRole('button', { name: button, exact: true }).click(); await page.getByRole('button', { name: confirmation, exact: true }).click(); await page.locator('#message').filter({ hasText: outcome }).waitFor();
      };
      await action('Start project', 'Confirm start', /Project started/);
      await action('Mark delivered', 'Confirm delivery', /Delivery requires/); assert.equal((await read(root)).status, 'in_progress'); assert.equal(await page.locator('#reload').isVisible(), true);
      const dform = page.locator('#create-deliverable'), fform = page.locator('#create-feedback');
      const submit = async (title: string, url: string, milestone = '') => {
        await reveal(page, '#create-deliverable');
        await dform.getByLabel('Title', { exact: true }).fill(title); await dform.getByLabel('HTTP(S) artifact URL').fill(url); await dform.getByLabel('Milestone (optional)').selectOption(milestone);
        const response = page.waitForResponse(r => r.url().endsWith('/deliverables') && r.request().method() === 'POST'); await dform.getByRole('button', { name: 'Submit deliverable', exact: true }).click(); return (await response).status();
      };
      assert.equal(await submit(' ', 'https://example.test/artifact'), 400); await page.locator('#deliverable-delivery-status').filter({ hasText: /Missing or invalid/ }).waitFor();
      assert.equal(await submit('Unsafe URL', 'javascript:alert(1)'), 400); await page.locator('#deliverable-delivery-status').filter({ hasText: /HTTP or HTTPS/ }).waitFor();
      // A stale or manipulated relationship selection remains a useful missing-resource error.
      await dform.locator('select[name=milestoneId]').evaluate(select => { const option = document.createElement('option'); option.value = 'missing'; option.textContent = 'Missing milestone'; select.append(option); });
      assert.equal(await submit('Missing relation', 'https://example.test/artifact', 'missing'), 404); await page.locator('#deliverable-delivery-status').filter({ hasText: /not found/ }).waitFor();
      assert.equal(await submit('<b>First artifact</b>', 'https://example.test/first'), 200); await page.locator('#deliverables').getByText('<b>First artifact</b>', { exact: true }).waitFor();
      assert.equal(await submit('Milestone artifact', 'http://example.test/second', 'm'), 200); await page.locator('#deliverables').getByText('Milestone artifact', { exact: true }).waitFor();
      assert.equal(await page.locator('#deliverables b').count(), 0);
      const link = page.locator('#deliverables a', { hasText: 'https://example.test/first' }); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(await link.getAttribute('target'), '_blank');
      let deliveries = await read(root + '/deliverables'); assert.equal(deliveries.find((d: any) => d.title === 'Milestone artifact').milestoneId, 'm');
      assert.equal(deliveries.find((d: any) => d.title === '<b>First artifact</b>').milestoneId, undefined);
      await action('Mark delivered', 'Confirm delivery', /Delivery requires/);

      const addFeedback = async (source: string, sentiment: string, message: string, deliverableId = '') => {
        await reveal(page, '#create-feedback');
        await fform.getByLabel('Author/source').fill(source); await fform.getByLabel('Sentiment', { exact: true }).selectOption(sentiment); await fform.getByLabel('Message', { exact: true }).fill(message); await fform.getByLabel('Deliverable (optional)').selectOption(deliverableId);
        const response = page.waitForResponse(r => r.url().endsWith('/feedback') && r.request().method() === 'POST'); await fform.getByRole('button', { name: 'Add feedback', exact: true }).click(); return (await response).status();
      };
      assert.equal(await addFeedback(' ', 'neutral', 'Invalid source'), 400); await page.locator('#feedback-delivery-status').filter({ hasText: /Missing or invalid/ }).waitFor();
      await fform.locator('select[name=deliverableId]').evaluate(select => { const option = document.createElement('option'); option.value = 'missing'; option.textContent = 'Missing deliverable'; select.append(option); });
      assert.equal(await addFeedback('Client', 'neutral', 'Missing relation', 'missing'), 404); await page.locator('#feedback-delivery-status').filter({ hasText: /not found/ }).waitFor();
      for (const sentiment of ['positive', 'neutral', 'negative']) {
        const relation = sentiment === 'negative' ? deliveries[0].id : '';
        assert.equal(await addFeedback('Client ' + sentiment, sentiment, '<img src=x onerror=alert(1)> Review ' + sentiment, relation), 200);
        await page.locator('#feedback').getByText('<img src=x onerror=alert(1)> Review ' + sentiment, { exact: true }).waitFor();
      }
      assert.equal(await page.locator('#feedback img').count(), 0);
      await action('Hold project', 'Confirm hold', /Project placed on hold/);
      assert.equal(await offered('#create-deliverable'), false); assert.equal(await offered('#create-feedback'), true); assert.equal(await page.getByRole('button', { name: 'Mark delivered', exact: true }).count(), 0);
      assert.equal(await page.locator('#deliverables').getByRole('button', { name: 'Accept deliverable', exact: true }).count(), 2);
      const stale = await context.newPage(); stale.on('pageerror', error => errors.push(error.message)); await stale.goto(page.url()); await stale.locator('#deliverables').getByText('<b>First artifact</b>', { exact: true }).waitFor(); await stale.locator('#feedback').getByText('Client positive', { exact: true }).waitFor();
      const first = page.locator('#records-deliverables article').filter({ hasText: '<b>First artifact</b>' }); await first.getByRole('button', { name: 'Accept deliverable', exact: true }).click(); await page.locator('#deliverable-delivery-status').filter({ hasText: 'Deliverable accepted.' }).waitFor();
      const staleFirst = stale.locator('#records-deliverables article').filter({ hasText: '<b>First artifact</b>' }); await staleFirst.getByRole('button', { name: 'Accept deliverable', exact: true }).click(); await stale.locator('#deliverable-delivery-status').filter({ hasText: /already accepted|changed/ }).waitFor(); assert.equal(await stale.locator('#reload').isVisible(), true);
      await page.locator('#records-deliverables article').filter({ hasText: 'Milestone artifact' }).getByRole('button', { name: 'Accept deliverable', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('#deliverables .delivery-action').length === 0);
      await action('Resume project', 'Confirm resume', /Project resumed/); await action('Mark delivered', 'Confirm delivery', /Delivery requires/);
      const positive = page.locator('#records-feedback article').filter({ hasText: 'Review positive' }); await positive.getByLabel('Response note (optional)').fill('<b>Handled</b>'); await positive.getByRole('button', { name: 'Address feedback', exact: true }).click(); await page.locator('#feedback-delivery-status').filter({ hasText: 'Feedback addressed.' }).waitFor();
      await stale.locator('#records-feedback article').filter({ hasText: 'Review positive' }).getByRole('button', { name: 'Address feedback', exact: true }).click(); await stale.locator('#feedback-delivery-status').filter({ hasText: /already addressed|changed/ }).waitFor();
      await stale.getByRole('button', { name: 'Reload project', exact: true }).click(); await stale.locator('#feedback').getByText('<b>Handled</b>', { exact: true }).waitFor(); await stale.close();
      for (const sentiment of ['neutral', 'negative']) { await page.locator('#records-feedback article').filter({ hasText: 'Review ' + sentiment }).getByRole('button', { name: 'Address feedback', exact: true }).click(); await page.waitForFunction(sentiment => !Array.from(document.querySelectorAll('#feedback article')).find(article => article.textContent?.includes('Review ' + sentiment))?.querySelector('button'), sentiment); }
      await page.locator('#delivery-readiness-status').filter({ hasText: /^Ready:/ }).waitFor(); await page.reload(); await page.locator('#delivery-readiness-status').filter({ hasText: /^Ready:/ }).waitFor();
      deliveries = await read(root + '/deliverables'); const reviews = await read(root + '/feedback');
      assert.ok(deliveries.every((d: any) => d.status === 'accepted' && d.acceptedAtIso)); assert.ok(reviews.every((f: any) => f.status === 'addressed' && f.addressedBy === 'operator' && f.addressedAtIso));
      assert.equal(reviews.find((f: any) => f.sentiment === 'negative').deliverableId, deliveries.find((d: any) => d.title === 'Milestone artifact').id);
      assert.equal(reviews.find((f: any) => f.sentiment === 'neutral').responseNote, undefined); assert.equal(await page.locator('#feedback b').count(), 0);
      await action('Mark delivered', 'Confirm delivery', /Project marked delivered/); assert.equal(await offered('#create-deliverable'), false); assert.equal(await offered('#create-feedback'), true);
      assert.equal(await addFeedback('Post-delivery client', 'neutral', 'Post-delivery review'), 200); await page.locator('#feedback').getByText('Post-delivery review', { exact: true }).waitFor();
      await action('Archive project', 'Confirm archive', /Delivery requires/); assert.equal((await read(root)).status, 'delivered');
      await page.locator('#records-feedback article').filter({ hasText: 'Post-delivery review' }).getByRole('button', { name: 'Address feedback', exact: true }).click(); await page.locator('#delivery-readiness-status').filter({ hasText: /^Ready:/ }).waitFor();

      // Both delivery sections recover independently without losing the other section's records.
      const failed = new Set<string>(); await page.route('**/projectops/project-requests/r/*', async route => {
        const kind = route.request().url().split('/').at(-1)!;
        if (route.request().method() === 'GET' && ['deliverables', 'feedback'].includes(kind) && !failed.has(kind)) { failed.add(kind); await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary section failure.' }) }); } else await route.continue();
      });
      await page.reload(); await page.getByRole('button', { name: 'Retry deliverables', exact: true }).waitFor(); await page.getByRole('button', { name: 'Retry feedback', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Retry deliverables', exact: true }).click(); await page.locator('#deliverables').getByText('Milestone artifact', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Retry feedback', exact: true }).isVisible(), true);
      await page.getByRole('button', { name: 'Retry feedback', exact: true }).click(); await page.locator('#delivery-readiness-status').filter({ hasText: /^Ready:/ }).waitFor();
      await action('Archive project', 'Confirm archive', /Project archived/); assert.equal(await offered('#create-deliverable'), false); assert.equal(await offered('#create-feedback'), false); assert.equal(await page.locator('.delivery-action').count(), 0);
      await page.reload(); await page.locator('#deliverables').getByText('Milestone artifact', { exact: true }).waitFor(); await page.locator('#feedback').getByText('Post-delivery review', { exact: true }).waitFor();
      // The database rejects unsafe URLs too. Rendering still treats an untrusted response defensively.
      await assert.rejects(() => pool.query("UPDATE projectops_project_deliverables SET artifact_url='javascript:alert(1)' WHERE project_request_id='r' AND title='Milestone artifact'"), { code: '23514' });
      await page.route('**/projectops/project-requests/r/deliverables', async route => {
        const response = await route.fetch(); const rows = await response.json();
        await route.fulfill({ response, json: rows.map((row: any) => row.title === 'Milestone artifact' ? { ...row, artifactUrl: 'javascript:alert(1)' } : row) });
      });
      await page.reload(); await page.locator('#deliverables').getByText('javascript:alert(1)', { exact: true }).waitFor(); assert.equal(await page.locator('#deliverables a[href^="javascript:"]').count(), 0);
      await send('project-requests', { id: 'cancel', clientId: 'c', title: 'Cancelled delivery', brief: 'Brief' }); await send('project-requests/cancel/estimate', { amountCents: 100 }); await send('project-requests/cancel/approve', { approvedBy: 'operator' });
      await send('project-requests/cancel/deliverables', { id: 'd', title: 'Unaccepted retained artifact', artifactUrl: 'https://example.test/cancel' }); await send('project-requests/cancel/feedback', { id: 'f', author: 'Client', message: 'Open retained feedback' });
      await visit('cancel'); await action('Cancel project', 'Confirm cancellation', /Project cancelled/); assert.equal(await offered('#create-deliverable'), false); assert.equal(await offered('#create-feedback'), false); assert.equal(await page.locator('.delivery-action').count(), 0);
      await page.locator('#deliverables').getByText('Unaccepted retained artifact', { exact: true }).waitFor(); await action('Archive project', 'Confirm archive', /Project archived/);
      await page.reload(); await page.locator('#feedback').getByText('Open retained feedback', { exact: true }).waitFor(); assert.deepEqual(errors, []);
    } finally { await browser?.close(); await app.close(); }
  });
});
