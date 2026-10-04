import { formatFinanceCents, formatFinanceTotal } from '../../../../packages/projectops/src/finances.ts';
import type { DashboardFilter, DashboardOperationalItem, ProjectOpsDashboardRow, ProjectRequestStatus } from '../../../../packages/projectops/src/index.ts';
import type { ProjectOpsDashboardPage } from './dashboard-view.ts';

export interface RenderedProjectOpsDashboard {
  readonly status: 200;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
}

const visibleStatuses = Object.freeze([
  'new',
  'estimated',
  'approved',
  'in_progress',
  'on_hold',
  'delivered',
] satisfies readonly ProjectRequestStatus[]);

export function renderProjectOpsDashboardPage(
  page: ProjectOpsDashboardPage
): RenderedProjectOpsDashboard {
  const summary = page.summary;
  const rows = summary.rows;
  const timezone = page.timezone;

  return Object.freeze({
    status: 200,
    headers: Object.freeze({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-cache, no-store',
    }),
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <style>${dashboardCss()}</style>
</head>
<body>
  <main class="projectops-shell" aria-labelledby="projectops-title">
    <header class="projectops-header">
      <a href="/projectops/settings">Operator settings</a>
      <a href="/projectops/client-management">Clients</a>
      <div>
        <p class="eyebrow">ProjectOps</p>
        <h1 id="projectops-title">${escapeHtml(page.title)}</h1>
      </div>
      <p class="header-note">${renderHeaderNote(summary.upcomingDeadlines[0], timezone)}</p>
    </header>

    <section class="requests" aria-label="Find projects">
      <form class="dashboard-filters" action="/projectops" method="get">
        <label>Search projects<input name="q" maxlength="120" value="${escapeHtml(summary.filter.q)}" placeholder="Project title or client name"></label>
        <div><label for="dashboard-status">Status</label><select id="dashboard-status" name="status"><option value="all"${summary.filter.status === 'all' ? ' selected' : ''}>All eligible states</option>${visibleStatuses.map(status => `<option value="${status}"${summary.filter.status === status ? ' selected' : ''}>${formatStatus(status)}</option>`).join('')}</select></div>
        <button type="submit">Apply</button><a href="/projectops">Reset</a>
      </form>
      <p class="result-scope">${escapeHtml(scopeLabel(summary.filter))} · ${rows.length} matching projects. <a href="${escapeHtml(dashboardUrl(summary.filter))}">Refresh dashboard</a></p>
      <p class="result-scope">Evaluated ${escapeHtml(formatDate(summary.evaluationNow, timezone))} (${escapeHtml(timezone)}).</p>
    </section>

    <section class="metrics" aria-label="Project request summary">
      ${renderMetric('Active requests', String(summary.totalActiveRequests))}
      ${renderMetric('High priority open', String(summary.highPriorityOpen))}
      ${renderMetric('Open milestones', String(summary.openMilestones))}
      ${renderMetric('Submitted deliverables', String(summary.submittedDeliverables))}
      ${renderMetric('Outstanding invoices', formatFinanceTotal(summary.financeTotalsByCurrency, 'outstandingInvoiceAmountCents'))}
      ${renderMetric('Paid invoices', formatFinanceTotal(summary.financeTotalsByCurrency, 'paidInvoiceAmountCents'))}
      ${renderMetric('Submitted expenses', formatFinanceTotal(summary.financeTotalsByCurrency, 'submittedExpenseAmountCents'))}
      ${renderMetric('Proposed changes', String(summary.proposedChangeRequests))}
      ${renderMetric('Open issues', String(summary.openIssues))}
      ${renderMetric('Open risks', String(summary.openRisks))}
      ${renderMetric('Open feedback', String(summary.openFeedback))}
      ${renderMetric('Active documents', String(summary.activeDocuments))}
      ${renderMetric('Active notes', String(summary.activeNotes))}
      ${renderMetric('Open tasks', String(summary.openTasks))}
      ${renderMetric('Billable hours', formatHours(summary.billableWorkMinutes))}
      ${renderMetric('Approved expenses', formatFinanceTotal(summary.financeTotalsByCurrency, 'approvedExpenseAmountCents'))}
      ${renderMetric('In progress', String(summary.byStatus.in_progress))}
      ${renderMetric('Delivered', String(summary.byStatus.delivered))}
    </section>

    <section class="workflow" aria-label="Workflow status">
      ${visibleStatuses.map((status) => renderWorkflowColumn(status, summary.byStatus[status])).join('')}
    </section>

    <section class="requests operational" aria-labelledby="overdue-title"><h2 id="overdue-title">Overdue work</h2>
      <p>${summary.overdueWorkCount} open tasks/milestones overdue.</p>
      ${renderOperational(summary.overdueWork, timezone, 'No overdue work.')}
    </section>
    <section class="requests operational" aria-labelledby="upcoming-title"><h2 id="upcoming-title">Upcoming deadlines</h2>
      <p>Nearest future operational deadline per matching project.</p>
      ${renderOperational(summary.upcomingDeadlines, timezone, 'No upcoming deadlines.')}
    </section>
    <section class="requests operational" aria-labelledby="outstanding-title"><h2 id="outstanding-title">Outstanding invoices</h2>
      <p>${summary.issuedInvoices} issued invoices · ${escapeHtml(formatFinanceTotal(summary.financeTotalsByCurrency, 'outstandingInvoiceAmountCents'))}</p>
      ${rows.some(row => (row.issuedInvoiceCount ?? 0) > 0) ? `<ul>${rows.filter(row => (row.issuedInvoiceCount ?? 0) > 0).map(row => `<li><a href="/projectops/projects/${encodeURIComponent(row.id)}#invoices">Invoices for ${escapeHtml(row.title)}</a> · ${row.issuedInvoiceCount} issued · ${escapeHtml(formatFinanceTotal(row.financeTotalsByCurrency ?? {}, 'outstandingInvoiceAmountCents'))}</li>`).join('')}</ul>` : '<p>No outstanding invoices.</p>'}
    </section>

    <section class="requests" aria-labelledby="active-requests-title">
      <div class="section-heading">
        <h2 id="active-requests-title">Active Requests</h2>
        <span>${rows.length} shown</span>
      </div>
      ${rows.length > 0 ? renderRequestsTable(rows, timezone) : renderEmptyState(summary.hasEligibleProjects)}
    </section>
  </main>
</body>
</html>`,
  });
}

function renderMetric(label: string, value: string): string {
  return `<article class="metric">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  </article>`;
}

function renderWorkflowColumn(status: ProjectRequestStatus, count: number): string {
  return `<article class="workflow-column" data-status="${escapeHtml(status)}">
    <span>${escapeHtml(formatStatus(status))}</span>
    <strong>${count}</strong>
  </article>`;
}

function renderRequestsTable(rows: readonly ProjectOpsDashboardRow[], timezone: string): string {
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Request</th>
          <th scope="col">Client</th>
          <th scope="col">Status</th>
          <th scope="col">Estimate</th>
          <th scope="col">Milestones</th>
          <th scope="col">Deliverables</th>
          <th scope="col">Invoices</th>
          <th scope="col">Changes</th>
          <th scope="col">Issues</th>
          <th scope="col">Risks</th>
          <th scope="col">Feedback</th>
          <th scope="col">Documents</th>
          <th scope="col">Notes</th>
          <th scope="col">Tasks</th>
          <th scope="col">Work</th>
          <th scope="col">Expenses</th>
          <th scope="col">Latest Activity</th>
          <th scope="col">Priority</th>
          <th scope="col">Deadline</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => renderRequestRow(row, timezone)).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderRequestRow(row: ProjectOpsDashboardRow, timezone: string): string {
  return `<tr>
    <td>
      <strong><a href="/projectops/projects/${encodeURIComponent(row.id)}">${escapeHtml(row.title)}</a></strong>
      <span class="muted">${escapeHtml(row.id)}</span>
    </td>
    <td>${escapeHtml(row.clientName)}</td>
    <td><span class="pill">${escapeHtml(formatStatus(row.status))}</span></td>
    <td>${escapeHtml(formatEstimate(row))}</td>
    <td>${escapeHtml(formatMilestones(row))}</td>
    <td>${escapeHtml(formatDeliverables(row))}</td>
    <td>${escapeHtml(formatInvoices(row))}</td>
    <td>${escapeHtml(formatChangeRequests(row))}</td>
    <td>${escapeHtml(formatIssues(row))}</td>
    <td>${escapeHtml(formatRisks(row))}</td>
    <td>${escapeHtml(formatFeedback(row))}</td>
    <td>${escapeHtml(formatDocuments(row))}</td>
    <td>${escapeHtml(formatNotes(row))}</td>
    <td>${escapeHtml(formatTasks(row))}</td>
    <td>${escapeHtml(formatWork(row))}</td>
    <td>${escapeHtml(formatExpenses(row))}</td>
    <td>${escapeHtml(formatLatestActivity(row, timezone))}</td>
    <td>${escapeHtml(formatPriority(row.priority))}</td>
    <td>${escapeHtml(row.deadlineIso ? formatDate(row.deadlineIso, timezone) : 'Not set')}</td>
  </tr>`;
}

function renderEmptyState(hasEligibleProjects: boolean): string {
  if (hasEligibleProjects) return '<div class="empty-state"><h3>No matching projects</h3><p>Change the search or status filter, or reset to all eligible projects.</p></div>';
  return `<div class="empty-state">
    <h3>No active project requests yet</h3>
    <p>Create a client and project request to start tracking delivery.</p>
  </div>`;
}

function renderHeaderNote(next: DashboardOperationalItem | undefined, timezone: string): string {
  return next ? `Next deadline: ${escapeHtml(next.projectTitle)} · ${escapeHtml(next.kind)} on ${escapeHtml(formatDate(next.dueAtIso, timezone))}` : 'No upcoming deadlines yet.';
}
function scopeLabel(filter: DashboardFilter): string {
  return `Scope: ${filter.status === 'all' ? 'all eligible states' : formatStatus(filter.status!)}${filter.q ? ' · search “' + filter.q + '”' : ''}`;
}
function dashboardUrl(filter: DashboardFilter): string {
  const query = new URLSearchParams({ q: filter.q ?? '', status: filter.status ?? 'all' });
  return '/projectops?' + query;
}
function renderOperational(items: readonly DashboardOperationalItem[], timezone: string, empty: string): string {
  if (!items.length) return `<p>${empty}</p>`;
  return `<ul>${items.map(item => `<li><a href="/projectops/projects/${encodeURIComponent(item.projectRequestId)}${item.kind === 'project' ? '' : '#' + item.kind + 's'}">${escapeHtml(item.projectTitle)} · ${escapeHtml(item.kind)}: ${escapeHtml(item.title)}</a> · ${escapeHtml(formatDate(item.dueAtIso, timezone))}${item.count > 1 ? ' · ' + item.count + ' overdue in this section' : ''}</li>`).join('')}</ul>`;
}
export function renderDashboardUnavailable(filter: DashboardFilter, status: 400 | 500) {
  return Object.freeze({ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>ProjectOps Dashboard</title><style>${dashboardCss()}</style></head><body><main class="projectops-shell"><h1>ProjectOps Dashboard</h1>${status === 400 ? '<p>Invalid dashboard filters. Search must be at most 120 characters; choose an eligible status.</p><a href="/projectops">Reset filters</a>' : `<p role="alert">Dashboard unavailable. No current metrics could be loaded.</p><a href="${escapeHtml(dashboardUrl(filter))}">Retry dashboard</a>`}</main></body></html>` });
}

function formatStatus(status: ProjectRequestStatus): string {
  return status
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPriority(priority: ProjectOpsDashboardRow['priority']): string {
  return priority[0].toUpperCase() + priority.slice(1);
}

function formatEstimate(row: ProjectOpsDashboardRow): string {
  if (row.estimateAmountCents === undefined || !row.estimateCurrency) {
    return 'Not estimated';
  }
  return formatFinanceCents(row.estimateAmountCents, row.estimateCurrency);
}

function formatMilestones(row: ProjectOpsDashboardRow): string {
  return `${row.completedMilestoneCount ?? 0} done / ${row.openMilestoneCount ?? 0} open`;
}

function formatDeliverables(row: ProjectOpsDashboardRow): string {
  return `${row.acceptedDeliverableCount ?? 0} accepted / ${row.submittedDeliverableCount ?? 0} submitted`;
}

function formatInvoices(row: ProjectOpsDashboardRow): string {
  const outstanding = formatFinanceTotal(row.financeTotalsByCurrency ?? {}, 'outstandingInvoiceAmountCents');
  return `${row.paidInvoiceCount ?? 0} paid / ${row.issuedInvoiceCount ?? 0} open (${outstanding})`;
}

function formatChangeRequests(row: ProjectOpsDashboardRow): string {
  return `${row.proposedChangeRequestCount ?? 0} proposed / ${row.approvedChangeRequestCount ?? 0} approved`;
}

function formatIssues(row: ProjectOpsDashboardRow): string {
  return `${row.openIssueCount ?? 0} open / ${row.highOpenIssueCount ?? 0} high`;
}

function formatRisks(row: ProjectOpsDashboardRow): string {
  return `${row.openRiskCount ?? 0} open / ${row.highOpenRiskCount ?? 0} high`;
}

function formatFeedback(row: ProjectOpsDashboardRow): string {
  return `${row.openFeedbackCount ?? 0} open / ${row.negativeOpenFeedbackCount ?? 0} negative`;
}

function formatDocuments(row: ProjectOpsDashboardRow): string {
  return `${row.activeDocumentCount ?? 0} active / ${row.archivedDocumentCount ?? 0} archived`;
}

function formatNotes(row: ProjectOpsDashboardRow): string {
  return `${row.activeNoteCount ?? 0} active / ${row.clientVisibleNoteCount ?? 0} client`;
}

function formatTasks(row: ProjectOpsDashboardRow): string {
  return `${row.openTaskCount ?? 0} open / ${row.highOpenTaskCount ?? 0} high`;
}

function formatWork(row: ProjectOpsDashboardRow): string {
  return `${formatHours(row.billableWorkMinutes ?? 0)} billable / ${formatHours(row.nonBillableWorkMinutes ?? 0)} non`;
}

function formatExpenses(row: ProjectOpsDashboardRow): string {
  const approved = formatFinanceTotal(row.financeTotalsByCurrency ?? {}, 'approvedExpenseAmountCents');
  return `${row.submittedExpenseCount ?? 0} submitted / ${row.approvedExpenseCount ?? 0} approved (${approved})`;
}

function formatLatestActivity(row: ProjectOpsDashboardRow, timezone: string): string {
  if (!row.latestActivitySummary || !row.latestActivityAtIso) {
    return 'No activity yet';
  }
  return `${row.latestActivitySummary} (${formatDate(row.latestActivityAtIso, timezone)})`;
}

function formatHours(minutes: number): string {
  return `${(minutes / 60).toLocaleString('en', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}h`;
}

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dashboardCss(): string {
  return `
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f9;
      color: #17202a;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-width: 320px;
      background: #f6f7f9;
    }

    .projectops-shell {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    .projectops-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }

    .eyebrow {
      margin: 0 0 6px;
      color: #52616f;
      font-size: 0.84rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 0; font-size: 2rem; line-height: 1.15; }
    h2 { margin-bottom: 0; font-size: 1.12rem; }
    h3 { margin-bottom: 8px; }

    .header-note {
      margin-bottom: 4px;
      color: #52616f;
      text-align: right;
    }

    .metrics, .workflow {
      display: grid;
      gap: 12px;
      margin-bottom: 20px;
    }

    .metrics {
      grid-template-columns: repeat(13, minmax(0, 1fr));
    }

    .workflow {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    .metric, .workflow-column, .requests {
      background: #ffffff;
      border: 1px solid #dfe4ea;
      border-radius: 8px;
    }

    .metric, .workflow-column {
      padding: 16px;
    }

    .metric span, .workflow-column span, .muted {
      color: #52616f;
      font-size: 0.86rem;
    }

    .metric strong {
      display: block;
      margin-top: 8px;
      font-size: 1.85rem;
      line-height: 1;
    }

    .workflow-column strong {
      display: block;
      margin-top: 8px;
      font-size: 1.35rem;
    }

    .dashboard-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; padding: 18px; }
    .dashboard-filters label { display: flex; flex-direction: column; gap: 6px; }
    input, select, button { font: inherit; padding: 8px; max-width: 100%; }
    .result-scope { padding: 0 18px; overflow-wrap: anywhere; }
    .operational { padding: 18px; margin-bottom: 20px; overflow-wrap: anywhere; }
    .operational li { margin: 10px 0; }
    .requests {
      overflow: hidden;
    }

    .section-heading {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 18px;
      border-bottom: 1px solid #dfe4ea;
    }

    .section-heading span {
      color: #52616f;
      font-size: 0.9rem;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 14px 18px;
      text-align: left;
      border-bottom: 1px solid #edf0f3;
      vertical-align: top;
    }

    th {
      color: #52616f;
      font-size: 0.8rem;
      text-transform: uppercase;
    }

    td strong, td span {
      display: block;
    }

    .pill {
      display: inline-block;
      width: fit-content;
      padding: 4px 8px;
      border-radius: 999px;
      background: #e9eef5;
      color: #17202a;
      font-size: 0.84rem;
      font-weight: 700;
    }

    .empty-state {
      padding: 32px 18px;
      color: #52616f;
    }

    .empty-state h3 {
      color: #17202a;
    }

    @media (max-width: 820px) {
      .projectops-header {
        align-items: start;
        flex-direction: column;
      }

      .header-note {
        text-align: left;
      }

      .metrics, .workflow {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 520px) {
      .projectops-shell {
        width: min(100% - 20px, 1180px);
        padding: 20px 0;
      }

      .metrics, .workflow {
        grid-template-columns: 1fr;
      }

      th, td {
        padding: 12px;
      }
    }
  `;
}
