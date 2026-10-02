import type { ProjectOpsDashboardRow, ProjectRequestStatus } from '../../../../packages/projectops/src/index.ts';
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
  'delivered',
] satisfies readonly ProjectRequestStatus[]);

export function renderProjectOpsDashboardPage(
  page: ProjectOpsDashboardPage
): RenderedProjectOpsDashboard {
  const summary = page.summary;
  const rows = summary.rows;

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
      <div>
        <p class="eyebrow">ProjectOps</p>
        <h1 id="projectops-title">${escapeHtml(page.title)}</h1>
      </div>
      <p class="header-note">${renderHeaderNote(summary.nextDeadline)}</p>
    </header>

    <section class="metrics" aria-label="Project request summary">
      ${renderMetric('Active requests', String(summary.totalActiveRequests))}
      ${renderMetric('High priority open', String(summary.highPriorityOpen))}
      ${renderMetric('Open milestones', String(summary.openMilestones))}
      ${renderMetric('Submitted deliverables', String(summary.submittedDeliverables))}
      ${renderMetric('Outstanding invoices', formatMoney(summary.outstandingInvoiceAmountCents, 'USD'))}
      ${renderMetric('In progress', String(summary.byStatus.in_progress))}
      ${renderMetric('Delivered', String(summary.byStatus.delivered))}
    </section>

    <section class="workflow" aria-label="Workflow status">
      ${visibleStatuses.map((status) => renderWorkflowColumn(status, summary.byStatus[status])).join('')}
    </section>

    <section class="requests" aria-labelledby="active-requests-title">
      <div class="section-heading">
        <h2 id="active-requests-title">Active Requests</h2>
        <span>${rows.length} shown</span>
      </div>
      ${rows.length > 0 ? renderRequestsTable(rows) : renderEmptyState()}
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

function renderRequestsTable(rows: readonly ProjectOpsDashboardRow[]): string {
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
          <th scope="col">Priority</th>
          <th scope="col">Deadline</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(renderRequestRow).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderRequestRow(row: ProjectOpsDashboardRow): string {
  return `<tr>
    <td>
      <strong>${escapeHtml(row.title)}</strong>
      <span class="muted">${escapeHtml(row.id)}</span>
    </td>
    <td>${escapeHtml(row.clientName)}</td>
    <td><span class="pill">${escapeHtml(formatStatus(row.status))}</span></td>
    <td>${escapeHtml(formatEstimate(row))}</td>
    <td>${escapeHtml(formatMilestones(row))}</td>
    <td>${escapeHtml(formatDeliverables(row))}</td>
    <td>${escapeHtml(formatInvoices(row))}</td>
    <td>${escapeHtml(formatPriority(row.priority))}</td>
    <td>${escapeHtml(row.deadlineIso ? formatDate(row.deadlineIso) : 'Not set')}</td>
  </tr>`;
}

function renderEmptyState(): string {
  return `<div class="empty-state">
    <h3>No active project requests yet</h3>
    <p>Create a client and project request to start tracking delivery.</p>
  </div>`;
}

function renderHeaderNote(nextDeadline: ProjectOpsDashboardRow | undefined): string {
  if (!nextDeadline?.deadlineIso) {
    return 'No upcoming deadlines yet.';
  }
  return `Next deadline: ${escapeHtml(nextDeadline.title)} on ${escapeHtml(formatDate(nextDeadline.deadlineIso))}`;
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
  const amount = (row.estimateAmountCents / 100).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${row.estimateCurrency} ${amount}`;
}

function formatMilestones(row: ProjectOpsDashboardRow): string {
  return `${row.completedMilestoneCount ?? 0} done / ${row.openMilestoneCount ?? 0} open`;
}

function formatDeliverables(row: ProjectOpsDashboardRow): string {
  return `${row.acceptedDeliverableCount ?? 0} accepted / ${row.submittedDeliverableCount ?? 0} submitted`;
}

function formatInvoices(row: ProjectOpsDashboardRow): string {
  const outstanding = formatMoney(row.outstandingInvoiceAmountCents ?? 0, row.estimateCurrency ?? 'USD');
  return `${row.paidInvoiceCount ?? 0} paid / ${row.issuedInvoiceCount ?? 0} open (${outstanding})`;
}

function formatMoney(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(value));
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
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .workflow {
      grid-template-columns: repeat(5, minmax(0, 1fr));
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
