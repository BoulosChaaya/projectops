import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';

test('Chromium completed workflows automatically refresh trusted history, annotations, conflicts, retries and terminal views', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 }); let browser;
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'history-browser-password');
      browser = await chromium.launch({ headless: true }); const context = await browser.newContext(), page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.server.origin + '/projectops/login'); await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('history-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');
      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(r => r.json());
      const send = async (path: string, data: unknown) => { const r = await context.request.post(app.server.origin + '/projectops/' + path, { headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data }); assert.equal(r.status(), 200, await r.text()); return r.json(); };
      const read = (path: string) => context.request.get(app.server.origin + '/projectops/' + path).then(r => r.json());
      await send('access/settings', { defaultCurrency: 'EUR', defaultPriority: 'medium', timezone: 'Europe/Paris' });
      await send('clients', { id: 'c', name: 'History client' }); await page.goto(app.server.origin + '/projectops/client-management/c');
      await page.waitForFunction(() => !(document.querySelector('#create-project button') as HTMLButtonElement).disabled);
      await page.locator('#create-project [name=title]').fill('History project'); await page.locator('#create-project [name=brief]').fill('Brief'); await page.locator('#create-project button').click(); await page.waitForURL('**/projects/*');
      const projectId = page.url().split('/').at(-1)!, root = 'project-requests/' + projectId;
      let count = 0;
      const event = async (type: string) => {
        count++; await page.waitForFunction(expected => document.querySelectorAll('#records-activities article').length === expected, count);
        const rows = await read(root + '/activities'); assert.equal(rows.length, count); assert.ok(rows.some((r: any) => r.eventType === type));
        assert.ok(rows.every((r: any) => r.actor === 'operator' && r.createdAtIso === r.happenedAtIso));
        assert.equal(await page.locator('#records-activities [data-event-type="' + type + '"]').count(), rows.filter((r: any) => r.eventType === type).length);
        assert.deepEqual(await page.locator('#records-activities article').evaluateAll(elements => elements.map(e => (e as HTMLElement).dataset.activityId)), rows.map((r: any) => r.id));
        assert.match((await page.locator('.history-metadata').first().textContent())!, /operator.*Europe\/Paris/);
      };
      const submit = async (selector: string, fields: Record<string, string>, type: string) => { for (const [name, value] of Object.entries(fields)) await page.locator(selector + ' [name=' + name + ']').fill(value); await page.locator(selector + ' button').click(); await event(type); };
      const control = async (button: string, confirm: string) => { await page.getByRole('button', { name: button, exact: true }).click(); await page.getByRole('button', { name: confirm, exact: true }).click(); await event(button === 'Approve estimate' ? 'request_approved' : 'status_changed'); };
      await event('request_created');
      await submit('#edit-project', { title: 'Edited history project' }, 'request_edited');
      await submit('#estimate-form', { amount: '100', currency: 'EUR' }, 'request_estimated'); await control('Approve estimate', 'Confirm approval');
      await submit('#create-milestone', { title: 'History milestone' }, 'milestone_created');
      await submit('#milestones .planning-edit', { title: 'Edited milestone' }, 'milestone_edited');
      await page.getByRole('button', { name: 'Complete milestone', exact: true }).click(); await event('milestone_completed'); await page.getByRole('button', { name: 'Reopen milestone', exact: true }).click(); await event('milestone_reopened');
      await submit('#create-task', { title: 'History task' }, 'task_created');
      await submit('#tasks .planning-edit', { title: 'Edited task' }, 'task_edited');
      await page.getByRole('button', { name: 'Complete task', exact: true }).click(); await event('task_completed'); await page.getByRole('button', { name: 'Reopen task', exact: true }).click(); await event('task_reopened');
      await submit('#create-work-log', { minutes: '30', note: 'Work' }, 'work_log_added');
      await submit('#create-note', { body: '<img src=x onerror=alert(1)> Source note' }, 'note_added'); await page.getByRole('button', { name: 'Archive note', exact: true }).click(); await event('note_archived');
      await submit('#create-issue', { title: 'History issue', description: 'Description' }, 'issue_created'); await page.getByRole('button', { name: 'Resolve issue', exact: true }).click(); await event('issue_resolved');
      await submit('#create-risk', { title: 'History risk', description: 'Description' }, 'risk_created'); await page.getByRole('button', { name: 'Mitigate risk', exact: true }).click(); await event('risk_mitigated');
      await submit('#create-document', { title: 'History document', url: 'https://example.test/document' }, 'document_added'); await page.getByRole('button', { name: 'Archive document', exact: true }).click(); await event('document_archived');
      await submit('#create-deliverable', { title: 'History deliverable', artifactUrl: 'https://example.test/artifact' }, 'deliverable_submitted'); await page.getByRole('button', { name: 'Accept deliverable', exact: true }).click(); await event('deliverable_accepted');
      await submit('#create-feedback', { author: 'Client source', message: 'Feedback' }, 'feedback_added'); await page.getByRole('button', { name: 'Address feedback', exact: true }).click(); await event('feedback_addressed');
      await submit('#create-invoice', { invoiceNumber: 'HISTORY-1', amountCents: '123', currency: 'EUR' }, 'invoice_issued');
      const stale = await context.newPage(); stale.on('pageerror', error => errors.push(error.message)); await stale.goto(page.url()); await stale.getByRole('button', { name: 'Record payment', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Record payment', exact: true }).click(); await event('invoice_paid'); const paidHistory = await read(root + '/activities');
      await stale.getByRole('button', { name: 'Record payment', exact: true }).click(); await stale.locator('#invoice-finance-status').filter({ hasText: /already paid|changed/ }).waitFor(); assert.deepEqual(await read(root + '/activities'), paidHistory); await stale.close();
      await submit('#create-expense', { description: 'History approved expense', amountCents: '222', currency: 'USD', incurredAtIso: '2026-10-01T09:30' }, 'expense_submitted'); await page.getByRole('button', { name: 'Approve expense', exact: true }).click(); await event('expense_approved');
      await submit('#create-expense', { description: 'History rejected expense', amountCents: '333', currency: 'USD' }, 'expense_submitted'); await page.getByRole('button', { name: 'Reject expense', exact: true }).click(); await event('expense_rejected');
      const expense = (await read(root + '/expenses')).find((r: any) => r.description === 'History approved expense'); assert.equal(expense.incurredAtIso, '2026-10-01T09:30:00.000Z'); assert.ok((await read(root + '/activities')).filter((r: any) => r.eventType.startsWith('expense_')).every((r: any) => r.happenedAtIso !== expense.incurredAtIso));
      await page.locator('#create-annotation [name=summary]').fill(' '); await page.getByRole('button', { name: 'Add annotation', exact: true }).click(); await page.locator('#annotation-status').filter({ hasText: /Missing or invalid/ }).waitFor(); assert.equal((await read(root + '/activities')).length, count);
      await submit('#create-annotation', { summary: '<b>Operator context</b>' }, 'operator_annotation'); assert.equal(await page.locator('#activities b,#activities img').count(), 0); await page.locator('#activities').getByText('<b>Operator context</b>', { exact: true }).waitFor();
      // A failed history GET cannot turn a committed business action into a failed/retried mutation.
      let failNext = true, taskWrites = 0;
      await page.route('**/projectops/' + root + '/activities', async route => { if (route.request().method() === 'GET' && failNext) { failNext = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary history failure' }) }); } else await route.continue(); });
      page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/tasks')) taskWrites++; });
      await page.locator('#create-task [name=title]').fill('Committed despite history GET failure'); await page.locator('#create-task button').click(); await page.locator('#task-planning-status').filter({ hasText: 'Task created.' }).waitFor(); await page.getByRole('button', { name: 'Retry history', exact: true }).waitFor(); assert.equal(taskWrites, 1); assert.equal((await read(root + '/activities')).length, count + 1);
      await page.getByRole('button', { name: 'Retry history', exact: true }).click(); await event('task_created'); assert.equal(taskWrites, 1); await page.unroute('**/projectops/' + root + '/activities');
      // An older GET deliberately returns its old snapshot after the new annotation refresh.
      let signal!: () => void, resume!: () => void, done!: () => void, intercept = true;
      const reached = new Promise<void>(resolve => signal = resolve), proceed = new Promise<void>(resolve => resume = resolve), delivered = new Promise<void>(resolve => done = resolve);
      await page.route('**/projectops/' + root + '/activities', async route => { if (route.request().method() === 'GET' && intercept) { intercept = false; const response = await route.fetch(), rows = await response.json(); signal(); await proceed; await route.fulfill({ response, json: rows }); done(); } else await route.continue(); });
      await page.evaluate(() => { void (window as any).loadHistory(); }); await reached;
      await submit('#create-annotation', { summary: 'Newest annotation survives old GET' }, 'operator_annotation'); resume(); await delivered;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); await page.locator('#activities').getByText('Newest annotation survives old GET', { exact: true }).waitFor(); assert.equal(await page.locator('#records-activities article').count(), count); await page.unroute('**/projectops/' + root + '/activities');
      await page.reload(); await page.waitForFunction(expected => document.querySelectorAll('#records-activities article').length === expected, count);
      await control('Start project', 'Confirm start'); await control('Hold project', 'Confirm hold'); assert.equal(await page.locator('#create-annotation').isVisible(), true); await control('Resume project', 'Confirm resume'); await control('Mark delivered', 'Confirm delivery');
      await submit('#create-feedback', { author: 'Client source', message: 'Post-delivery feedback' }, 'feedback_added');
      const beforeBlockedArchive = await read(root + '/activities'); await page.getByRole('button', { name: 'Archive project', exact: true }).click(); await page.getByRole('button', { name: 'Confirm archive', exact: true }).click(); await page.locator('#message').filter({ hasText: /feedback/ }).waitFor(); assert.deepEqual(await read(root + '/activities'), beforeBlockedArchive);
      await page.getByRole('button', { name: 'Address feedback', exact: true }).click(); await event('feedback_addressed'); await control('Archive project', 'Confirm archive'); assert.equal(await page.locator('#create-annotation').isVisible(), false);
      await page.reload(); await page.waitForFunction(expected => document.querySelectorAll('#records-activities article').length === expected, count); assert.equal(await page.locator('#create-annotation').isVisible(), false); assert.match((await page.locator('#history-help').textContent())!, /retained/);
      // Cancellation and cancelled archival retain their own events without delivery readiness.
      await send('project-requests', { id: 'cancel', clientId: 'c', title: 'Cancelled history', brief: 'Brief' }); await page.goto(app.server.origin + '/projectops/projects/cancel'); await page.waitForFunction(() => document.querySelectorAll('#records-activities article').length === 1);
      await page.getByRole('button', { name: 'Cancel project', exact: true }).click(); await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('#records-activities article').length === 2); assert.equal(await page.locator('#create-annotation').isVisible(), false);
      await page.getByRole('button', { name: 'Archive project', exact: true }).click(); await page.getByRole('button', { name: 'Confirm archive', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('#records-activities article').length === 3); assert.deepEqual(errors, []);
    } finally { await browser?.close(); await app.close(); }
  });
});
