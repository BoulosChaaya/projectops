import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';

const T0 = '2026-10-03T12:00:00.000Z';

test('Execution workspace manages five resource types, conflicts and read-only lifecycle states', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0, clock: () => T0 });
    await new ProjectOpsOperatorStore(pool).provision('operator', 'execution-browser-password');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(); const page = await context.newPage(); const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.server.origin + '/projectops/login');
      await page.getByLabel('Login', { exact: true }).fill('operator'); await page.getByLabel('Password', { exact: true }).fill('execution-browser-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL('**/projectops');
      const session = await context.request.get(app.server.origin + '/projectops/access/session').then(response => response.json());
      const send = async (path: string, data: unknown) => {
        const response = await context.request.post(app.server.origin + '/projectops/' + path, { headers: { origin: app.server.origin, 'x-csrf-token': session.csrfToken }, data });
        assert.equal(response.status(), 200, await response.text()); return response.json();
      };
      const read = (path: string) => context.request.get(app.server.origin + '/projectops/' + path).then(response => response.json());

      await send('clients', { id: 'execution-client', name: 'Execution client' });
      await send('project-requests', { id: 'execution-project', clientId: 'execution-client', title: 'Execution project', brief: 'Brief' });
      await page.goto(app.server.origin + '/projectops/projects/execution-project');
      await page.getByRole('heading', { name: 'Execution project', exact: true }).waitFor();
      assert.equal(await page.locator('#create-note').isVisible(), true);
      for (const selector of ['#create-work-log', '#create-document', '#create-issue', '#create-risk']) assert.equal(await page.locator(selector).isVisible(), false);
      await page.locator('#create-note').getByLabel('Note', { exact: true }).fill('New-state note');
      await page.locator('#create-note').getByRole('button', { name: 'Add note', exact: true }).click();
      await page.locator('#notes').getByText('New-state note', { exact: true }).waitFor();

      await send('project-requests/execution-project/estimate', { amountCents: 10000, currency: 'USD' });
      await send('project-requests/execution-project/approve', { approvedBy: 'operator' });
      await send('project-requests/execution-project/tasks', { id: 'task-link', title: 'Linked task' });
      await send('project-requests/execution-project/milestones', { id: 'milestone-link', title: 'Linked milestone' });
      await send('project-requests/execution-project/milestones/milestone-link/complete', {});
      await send('project-requests/execution-project/deliverables', { id: 'deliverable-link', milestoneId: 'milestone-link', title: 'Linked deliverable', artifactUrl: 'https://example.test/artifact' });

      let failedRisks = false;
      await page.route('**/projectops/project-requests/execution-project/risks', async route => {
        if (!failedRisks) { failedRisks = true; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary risk failure.' }) }); }
        else await route.continue();
      });
      await page.reload();
      await page.getByRole('button', { name: 'Retry risks', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Retry risks', exact: true }).click();
      await page.locator('#records-risks').getByText('No risks recorded.', { exact: true }).waitFor();

      const issueForm = page.locator('#create-issue');
      await issueForm.getByLabel('Title', { exact: true }).fill(' '); await issueForm.getByLabel('Description', { exact: true }).fill('Description');
      const invalidIssue = page.waitForResponse(response => response.url().endsWith('/issues') && response.request().method() === 'POST');
      await issueForm.getByRole('button', { name: 'Add issue', exact: true }).click(); assert.equal((await invalidIssue).status(), 400);
      await page.waitForFunction(() => Boolean(document.getElementById('issue-execution-status')?.textContent));
      assert.match(await page.locator('#issue-execution-status').textContent() ?? '', /Missing or invalid field: title/);
      await issueForm.getByLabel('Title', { exact: true }).fill('<b>Production issue</b>'); await issueForm.getByLabel('Owner', { exact: true }).fill('Owner');
      await issueForm.getByRole('button', { name: 'Add issue', exact: true }).click();
      await page.locator('#issues').getByText('<b>Production issue</b>', { exact: true }).waitFor(); assert.equal(await page.locator('#issues b').count(), 0);

      const workForm = page.locator('#create-work-log');
      await workForm.getByLabel('Task ID (optional)').fill('task-link'); await workForm.getByLabel('Minutes').fill('45'); await workForm.getByLabel('Billable').uncheck(); await workForm.getByLabel('Note', { exact: true }).fill('Implemented execution');
      await workForm.getByRole('button', { name: 'Log work', exact: true }).click(); await page.locator('#work-logs').getByText('Implemented execution', { exact: true }).waitFor();

      const noteForm = page.locator('#create-note');
      await noteForm.getByLabel('Visibility').selectOption('client'); await noteForm.getByLabel('Note', { exact: true }).fill('<img src=x onerror=alert(1)> Client note');
      await noteForm.getByRole('button', { name: 'Add note', exact: true }).click(); await page.locator('#notes').getByText('<img src=x onerror=alert(1)> Client note', { exact: true }).waitFor(); assert.equal(await page.locator('#notes img').count(), 0);

      const documentForm = page.locator('#create-document');
      await documentForm.getByLabel('Title', { exact: true }).fill('Handoff link'); await documentForm.getByLabel('Type').selectOption('handoff'); await documentForm.getByLabel('HTTP(S) URL').fill('https://example.test/handoff'); await documentForm.getByLabel('Deliverable ID (optional)').fill('deliverable-link');
      await documentForm.getByRole('button', { name: 'Add document link', exact: true }).click();
      const link = page.locator('#documents a', { hasText: 'https://example.test/handoff' }); await link.waitFor(); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(await link.getAttribute('target'), '_blank');

      const riskForm = page.locator('#create-risk');
      await riskForm.getByLabel('Title', { exact: true }).fill('Delivery risk'); await riskForm.getByLabel('Description', { exact: true }).fill('Risk description'); await riskForm.getByLabel('Probability').selectOption('high'); await riskForm.getByLabel('Impact').selectOption('high'); await riskForm.getByLabel('Mitigation plan').fill('Mitigate carefully'); await riskForm.getByLabel('Owner', { exact: true }).fill('Owner');
      await riskForm.getByRole('button', { name: 'Add risk', exact: true }).click(); await page.locator('#risks').getByText('Delivery risk', { exact: true }).waitFor();

      const stale = await context.newPage(); stale.on('pageerror', error => errors.push(error.message)); await stale.goto(page.url());
      await stale.locator('#issues').getByText('<b>Production issue</b>', { exact: true }).waitFor();
      let issue = page.locator('#records-issues article').filter({ hasText: '<b>Production issue</b>' });
      await issue.getByLabel('Resolution note (optional)').fill('Resolved by operator'); await issue.getByRole('button', { name: 'Resolve issue', exact: true }).click();
      await page.locator('#issue-execution-status').getByText('Issue resolved.', { exact: true }).waitFor();
      const staleIssue = stale.locator('#records-issues article').filter({ hasText: '<b>Production issue</b>' });
      await staleIssue.getByRole('button', { name: 'Resolve issue', exact: true }).click(); await stale.locator('#issue-execution-status').getByText(/already resolved|changed/).waitFor(); assert.equal(await stale.getByRole('button', { name: 'Reload project', exact: true }).isVisible(), true); await stale.close();

      const risk = page.locator('#records-risks article').filter({ hasText: 'Delivery risk' });
      await risk.getByLabel('Mitigation note (optional)').fill('Mitigated by operator'); await risk.getByRole('button', { name: 'Mitigate risk', exact: true }).click();
      await page.locator('#risk-execution-status').getByText('Risk mitigated.', { exact: true }).waitFor();
      const clientNote = page.locator('#records-notes article').filter({ hasText: 'Client note' }); await clientNote.getByRole('button', { name: 'Archive note', exact: true }).click(); await page.locator('#note-execution-status').getByText('Note archived.', { exact: true }).waitFor();
      const handoffDocument = page.locator('#records-documents article').filter({ hasText: 'Handoff link' }); await handoffDocument.getByRole('button', { name: 'Archive document', exact: true }).click(); await page.locator('#document-execution-status').getByText('Document archived.', { exact: true }).waitFor();

      await page.reload(); await page.locator('#issues').getByText('Resolved by operator', { exact: true }).waitFor(); await page.locator('#risks').getByText('Mitigated by operator', { exact: true }).waitFor();
      const logs = await read('project-requests/execution-project/work-logs'); assert.equal(logs[0].actor, 'operator'); assert.equal(logs[0].taskId, 'task-link'); assert.equal(logs[0].billable, false);
      const documents = await read('project-requests/execution-project/documents'); assert.equal(documents[0].uploadedBy, 'operator'); assert.equal(documents[0].archivedBy, 'operator'); assert.equal(documents[0].deliverableId, 'deliverable-link');
      const notes = await read('project-requests/execution-project/notes'); assert.equal(notes.find((value: any) => value.status === 'archived').archivedBy, 'operator');

      let project = await read('project-requests/execution-project'); project = await send('project-requests/execution-project/control', { action: 'start', expectedRevision: project.revision }); project = await send('project-requests/execution-project/control', { action: 'hold', expectedRevision: project.revision });
      await page.reload(); await page.locator('#risks').getByText('Delivery risk', { exact: true }).waitFor();
      assert.equal(await page.locator('#create-work-log').isVisible(), false);
      for (const selector of ['#create-note', '#create-document', '#create-issue', '#create-risk']) assert.equal(await page.locator(selector).isVisible(), true);
      project = await send('project-requests/execution-project/control', { action: 'cancel', expectedRevision: project.revision });
      await page.reload(); await page.getByText('Cancelled projects are read-only.', { exact: true }).waitFor();
      for (const selector of ['#create-work-log', '#create-note', '#create-document', '#create-issue', '#create-risk']) assert.equal(await page.locator(selector).isVisible(), false);
      assert.equal(await page.locator('.execution-action').count(), 0); await page.locator('#work-logs').getByText('Implemented execution', { exact: true }).waitFor();
      project = await send('project-requests/execution-project/control', { action: 'archive', expectedRevision: project.revision }); assert.equal(project.status, 'archived');
      await page.reload(); await page.getByText('Archived projects are read-only.', { exact: true }).waitFor(); await page.locator('#documents').getByText('Handoff link', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await app.close(); }
  });
});
