import type { Page } from 'playwright';
import { workspaceTabs } from '../../apps/client/src/pages/project/sections.ts';

// How a user reaches a part of the project workspace: open its tab, then, for a create form,
// its "New …" panel and, for the project's edit form, its disclosure. Journeys call `reveal`
// before acting, so every step goes through the same controls an operator would use.

type TabLabel = typeof workspaceTabs[number]['label'];
const CREATE_TAB: Readonly<Record<string, TabLabel>> = {
  'create-milestone': 'Plan', 'create-task': 'Plan',
  'create-work-log': 'Work', 'create-note': 'Work', 'create-document': 'Work', 'create-issue': 'Work', 'create-risk': 'Work',
  'create-deliverable': 'Delivery', 'create-feedback': 'Delivery',
  'create-invoice': 'Money', 'create-expense': 'Money',
};
// Present on the Overview tab and on their own area's tab: no switch needed when either is open.
const SHARED = new Set(['delivery-readiness', 'delivery-readiness-status', 'finance-totals', 'finance-totals-status']);
const OVERVIEW = new Set(['overview', 'brief', 'budget', 'priority', 'approval', 'archived', 'edit-project', 'handoff', 'export-project', 'export-status', 'retry-export', 'view-delivery-summary']);

function tabFor(id: string): TabLabel | null {
  if (CREATE_TAB[id]) return CREATE_TAB[id];
  if (OVERVIEW.has(id)) return 'Overview';
  const section = id.replace(/^records-/, '').replace(/-(planning|execution|delivery|finance)-(status|help)$/, '');
  const singular: Record<string, string> = { milestone: 'milestones', task: 'tasks', 'work-log': 'work-logs', note: 'notes', document: 'documents',
    issue: 'issues', risk: 'risks', deliverable: 'deliverables', invoice: 'invoices', expense: 'expenses' };
  const path = singular[section] ?? section;
  return workspaceTabs.find(tab => (tab.sections as readonly string[]).includes(path))?.label ?? null;
}

export async function openTab(page: Page, label: TabLabel): Promise<void> {
  const link = page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: label, exact: true });
  if (await link.getAttribute('aria-current') !== 'page') await link.click();
  await page.locator(`.ws-tabs a[aria-current="page"]`).filter({ hasText: label }).waitFor();
}

/** Show the element a selector starts from: its tab, and its closed create panel or edit disclosure. */
export async function reveal(page: Page, selector: string): Promise<void> {
  const id = /#([A-Za-z0-9_-]+)/.exec(selector)?.[1];
  // Only the project workspace has tabs; other pages' forms are shown as they are.
  if (!id || !/^\/projectops\/projects\/[^/]+$/.test(new URL(page.url()).pathname)) return;
  await page.getByRole('navigation', { name: 'Project sections' }).waitFor();
  if (!(SHARED.has(id) && await page.locator('#' + id).count())) {
    const tab = SHARED.has(id) ? 'Overview' : tabFor(id);
    if (tab) await openTab(page, tab);
  }
  if (id.startsWith('create-') && id !== 'create-annotation' && id !== 'create-project') await open(page.locator(`details.ws-create:has(#${id})`));
  if (id === 'edit-project') await open(page.locator('details:has(#edit-project)'));
}

async function open(details: ReturnType<Page['locator']>): Promise<void> {
  await details.waitFor({ state: 'attached' });
  if (await details.getAttribute('open') === null) await details.locator('> summary').click();
}
