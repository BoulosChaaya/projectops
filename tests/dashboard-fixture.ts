import assert from 'node:assert/strict';
import type { ProjectOpsRepository } from '../packages/projectops/src/repository.ts';
import type { ProjectRequestStatus } from '../packages/projectops/src/domain.ts';

export const CREATED = '2026-10-01T00:00:00.000Z';
export const NOW = '2026-11-01T12:00:00.000Z';
export const BEFORE = '2026-10-31T12:00:00.000Z';
export const FUTURE = '2026-11-02T12:00:00.000Z';
export const SOURCE_CLIENT = "ÉCOLE Σİ Studio %_'\\";
export const allStates: readonly ProjectRequestStatus[] = ['new','estimated','approved','in_progress','on_hold','delivered','cancelled','archived'];

export async function seedDashboard(repo: ProjectOpsRepository) {
  await repo.createClient({ id: 'c', name: SOURCE_CLIENT, createdAtIso: CREATED });
  await repo.createClient({ id: 'other', name: 'Other client', createdAtIso: CREATED });
  for (const status of allStates) {
    await repo.createProjectRequest({ id: status, clientId: 'c', title: 'Project ' + status, brief: 'brief-only needle', deadlineIso: '2026-11-04T12:00:00Z', createdAtIso: CREATED });
    if (status === 'new') continue;
    await repo.estimateProjectRequest(status, { amountCents: 100, currency: 'GBP', estimatedAtIso: CREATED });
    const task = (id: string, dueAtIso?: string) => repo.createProjectTask(status, { id, projectRequestId: status, title: id === 'a-before' ? '<img src=x onerror=alert(1)> overdue task' : id, dueAtIso, createdAtIso: CREATED });
    await task('z-before', BEFORE); await task('a-before', '2026-10-31T14:00:00+02:00');
    await task('equal', '2026-11-01T14:00:00+02:00'); await task('future', '2026-11-03T14:00:00+02:00'); await task('no-date');
    const done = await task('done', BEFORE); await repo.completeProjectTask(status, done.id, { completedAtIso: NOW, completedBy: 'operator', expectedRevision: 1 });
    if (status === 'estimated') continue;
    await repo.approveProjectRequest(status, { approvedBy: 'operator', approvedAtIso: CREATED });
    for (const [id, dueAtIso] of [['before', BEFORE], ['equal', NOW], ['future', FUTURE], ['done', BEFORE], ['no-date', undefined]] as const) {
      await repo.createProjectMilestone(status, { id, projectRequestId: status, title: id === 'future' ? '<script>alert(1)</script> upcoming milestone' : id, dueAtIso, createdAtIso: CREATED });
    }
    await repo.completeProjectMilestone(status, 'done', { completedAtIso: NOW, expectedRevision: 1 });
    await repo.createProjectDeliverable(status, { id: 'ready', projectRequestId: status, title: 'Ready', artifactUrl: 'https://example.test/artifact', submittedAtIso: CREATED });
    await repo.acceptProjectDeliverable(status, 'ready', NOW);
    for (const id of ['i1','i2','i3']) await repo.createProjectInvoice(status, { id, projectRequestId: status, invoiceNumber: id, amountCents: 1_000_000_000, currency: 'EUR', issuedAtIso: CREATED, dueAtIso: '2026-11-01T12:01:00Z' });
    await repo.createProjectInvoice(status, { id: 'no-date', projectRequestId: status, invoiceNumber: 'No date', amountCents: 31, currency: 'USD', issuedAtIso: CREATED });
    await repo.createProjectInvoice(status, { id: 'paid', projectRequestId: status, invoiceNumber: 'Paid', amountCents: 19, currency: 'USD', issuedAtIso: CREATED, dueAtIso: BEFORE });
    await repo.markProjectInvoicePaid(status, 'paid', NOW);
    for (const [id, currency, amountCents] of [['submitted','USD',70],['approved','EUR',50],['rejected','EUR',79]] as const) {
      await repo.createProjectExpense(status, { id, projectRequestId: status, description: id, currency, amountCents, incurredAtIso: BEFORE });
      if (id === 'approved') await repo.approveProjectExpense(status, id, { decidedBy: 'operator', decidedAtIso: NOW });
      if (id === 'rejected') await repo.rejectProjectExpense(status, id, { decidedBy: 'operator', decidedAtIso: NOW });
    }
    if (['in_progress','on_hold','delivered'].includes(status)) await repo.transitionProjectRequest(status, 'in_progress', NOW);
    if (status === 'on_hold') await repo.transitionProjectRequest(status, 'on_hold', NOW);
    if (status === 'delivered') await repo.transitionProjectRequest(status, 'delivered', NOW);
    if (['cancelled','archived'].includes(status)) await repo.transitionProjectRequest(status, 'cancelled', NOW);
    if (status === 'archived') await repo.transitionProjectRequest(status, 'archived', NOW);
  }
  await repo.archiveClient('c', 1);
  await repo.createProjectRequest({ id: 'other-project', clientId: 'other', title: '<b>Other</b>', brief: 'Project approved hidden text', createdAtIso: CREATED });
}

export async function assertDashboardContract(repo: ProjectOpsRepository) {
  const dashboard = await repo.getDashboard({}, NOW);
  assert.equal(dashboard.totalActiveRequests, 7); assert.equal(dashboard.hasEligibleProjects, true);
  assert.equal(dashboard.overdueWorkCount, 14); assert.equal(dashboard.upcomingDeadlines.length, 6);
  assert.equal(dashboard.issuedInvoices, 16);
  assert.equal(dashboard.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents, '12000000000');
  assert.equal(dashboard.financeTotalsByCurrency.USD.outstandingInvoiceAmountCents, '124');
  assert.equal(dashboard.financeTotalsByCurrency.USD.paidInvoiceAmountCents, '76');
  assert.equal(dashboard.financeTotalsByCurrency.EUR.approvedExpenseAmountCents, '200');
  assert.equal(dashboard.financeTotalsByCurrency.USD.submittedExpenseAmountCents, '280');
  assert.equal(dashboard.financeTotalsByCurrency.GBP, undefined);
  assert.equal(dashboard.upcomingDeadlines.find(i => i.projectRequestId === 'delivered')!.kind, 'milestone');
  assert.equal(dashboard.upcomingDeadlines.find(i => i.projectRequestId === 'new')!.kind, 'project');
  assert.equal(dashboard.upcomingDeadlines.find(i => i.projectRequestId === 'estimated')!.kind, 'task');
  for (const row of dashboard.rows.filter(r => r.status !== 'new')) {
    assert.equal(row.overdueTaskCount, 2); assert.equal(row.nextOverdueTask!.id, 'a-before');
    assert.equal(row.nextOverdueTask!.dueAtIso, BEFORE);
  }
  assert.equal(dashboard.rows.some(r => ['archived','cancelled'].includes(r.status)), false);
  assert.deepEqual(dashboard.rows.map(r => r.id), ['delivered','in_progress','on_hold','approved','estimated','new','other-project']);
  for (const status of allStates) {
    if (['cancelled','archived'].includes(status)) { await assert.rejects(() => repo.getDashboard({ status: status as any }, NOW)); continue; }
    const filtered = await repo.getDashboard({ status: status as any }, NOW);
    assert.equal(filtered.rows.length, status === 'new' ? 2 : 1);
    assert.equal(filtered.rows.every(r => r.status === status), true);
  }
  for (const q of ['école σi', "%", '_', "'", '\\', '  STUDIO  ']) assert.equal((await repo.getDashboard({ q }, NOW)).rows.length, 6);
  assert.equal((await repo.getDashboard({ q: ' Project APPROVED ', status: 'approved' }, NOW)).rows.length, 1);
  const mismatch = await repo.getDashboard({ q: 'Project approved', status: 'delivered' }, NOW);
  assert.equal(mismatch.totalActiveRequests, 0); assert.deepEqual(mismatch.financeTotalsByCurrency, {});
  assert.equal(mismatch.overdueWorkCount, 0); assert.deepEqual(mismatch.upcomingDeadlines, []); assert.equal(mismatch.hasEligibleProjects, true);
  for (const q of ['brief-only', 'overdue task', 'upcoming milestone', 'i1', 'invoice_paid', "' OR 1=1 --"]) assert.equal((await repo.getDashboard({ q }, NOW)).rows.length, 0);
  assert.equal((await repo.getDashboard({ q: ' '.repeat(120) }, NOW)).totalActiveRequests, 7);
  assert.equal((await repo.getDashboard({ q: 'a'.repeat(120) }, NOW)).totalActiveRequests, 0);
  for (const filter of [{ q: 'a'.repeat(121) }, { status: 'invalid' }, { q: 3 }]) await assert.rejects(() => repo.getDashboard(filter as any, NOW));
  const scoped = await repo.getDashboard({ q: 'project approved' }, NOW);
  assert.equal(scoped.totalActiveRequests, 1); assert.equal(scoped.overdueWorkCount, 3); assert.equal(scoped.issuedInvoices, 4);
  assert.equal(scoped.financeTotalsByCurrency.EUR.outstandingInvoiceAmountCents, '3000000000');
  return dashboard;
}
