import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type ProjectOpsDashboardView } from '../api.ts';
import { AppShell } from '../components/app-shell.tsx';
import { useSession } from '../use-session.ts';
import { formatDateTime, formatHours, plural, statusLabel } from '../format.ts';
import { dashboardStatuses, type DashboardFilter, type DashboardOperationalItem, type ProjectOpsDashboardRow } from '../../../../packages/projectops/src/dashboard.ts';
import { formatFinanceCents, financeTotalKeys, type ProjectFinanceTotals, type ProjectFinanceTotalsByCurrency } from '../../../../packages/projectops/src/finances.ts';
import '../styles/dashboard.css';
import { tabForSection } from './project/sections.ts';

type Status = NonNullable<DashboardFilter['status']>;
type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly view: ProjectOpsDashboardView }
  | { readonly state: 'invalid'; readonly message: string }
  | { readonly state: 'unavailable' };

/** The filter lives in the address (?q=&status=), so it survives reloads, back/forward and shared links. */
function filterFromAddress(): { q: string; status: Status } {
  const query = new URLSearchParams(window.location.search);
  return { q: query.get('q') ?? '', status: (query.get('status') ?? 'all') as Status };
}
const dashboardHref = (filter: { q: string; status: string }) => `/projectops?${new URLSearchParams(filter)}`;
// A section link opens the workspace tab that shows it, scrolled to the section.
const projectHref = (id: string, section?: string) => `/projectops/projects/${encodeURIComponent(id)}${section ? `?tab=${tabForSection(section)}#${section}` : ''}`;

export function DashboardPage() {
  const [loaded] = useSession();
  const session = loaded.state === 'ready' ? loaded.session : null;
  const [filter] = useState(filterFromAddress);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let current = true;
    api.dashboard(filter).then(view => { if (current) setLoad({ state: 'ready', view }); }).catch((error: unknown) => {
      if (!current) return;
      if (error instanceof ApiError && error.status === 401) window.location.assign('/projectops/login');
      else if (error instanceof ApiError && error.status === 400) setLoad({ state: 'invalid', message: error.message });
      else setLoad({ state: 'unavailable' });
    });
    return () => { current = false; };
  }, [filter]);
  const timezone = session?.defaults.timezone;

  return (
    <AppShell session={session} title="Dashboard">
      {/* Re-mounted once the server returns its normalized filter, so the form shows what was applied. */}
      <FilterBar key={load.state === 'ready' ? 'applied' : 'requested'} filter={load.state === 'ready' ? load.view.filter : filter} />
      {load.state === 'loading' && <p className="dashboard-loading" aria-busy="true">Loading dashboard…</p>}
      {load.state === 'invalid' && (
        <div className="notice notice-error" role="alert">
          <p>{load.message}</p>
          <p><a href="/projectops">Reset filters</a></p>
        </div>
      )}
      {load.state === 'unavailable' && (
        <div className="notice notice-error" role="alert">
          <p>Dashboard unavailable. No current metrics could be loaded.</p>
          <p><a href={dashboardHref(filter)}>Retry dashboard</a></p>
        </div>
      )}
      {load.state === 'ready' && timezone && <Summary view={load.view} timezone={timezone} />}
      {load.state === 'ready' && loaded.state === 'loading' && <p className="dashboard-loading" aria-busy="true">Loading dashboard…</p>}
      {loaded.state === 'failed' && <p className="notice notice-error" role="alert">{loaded.message}</p>}
    </AppShell>
  );
}

function FilterBar({ filter }: { filter: { q?: string; status?: Status } }) {
  // An ordinary GET form: applying a filter is a navigation, so the browser history records it.
  return (
    <form className="filter-bar" method="get" action="/projectops" role="search">
      <div className="filter-field filter-search">
        <label htmlFor="dashboard-q">Search projects</label>
        <input id="dashboard-q" name="q" type="search" defaultValue={filter.q ?? ''} maxLength={120} placeholder="Project title or client name" />
      </div>
      <div className="filter-field">
        <label htmlFor="dashboard-status">Status</label>
        <select id="dashboard-status" name="status" defaultValue={filter.status ?? 'all'}>
          <option value="all">All active states</option>
          {dashboardStatuses.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
      </div>
      <button className="button button-primary">Apply</button>
      <a className="filter-reset" href="/projectops">Reset</a>
    </form>
  );
}

function Summary({ view, timezone }: { view: ProjectOpsDashboardView; timezone: string }) {
  const { filter, rows } = view;
  const scope = filter.status === 'all' ? 'all active states' : statusLabel(filter.status);
  return (
    <>
      <p className="result-scope">
        {plural(rows.length, 'matching project', 'matching projects')} in {scope}
        {filter.q ? <> for “{filter.q}”</> : null}. Evaluated {formatDateTime(view.evaluationNow, timezone)}, {timezone} time.
      </p>
      <Pipeline view={view} />
      {rows.length === 0 ? <EmptyState hasEligibleProjects={view.hasEligibleProjects} /> : null}
      <section className="attention" aria-label="Needs attention">
        <Panel id="overdue" title="Overdue work" lede={plural(view.overdueWorkCount, 'overdue task or milestone', 'overdue tasks and milestones')} tone={view.overdueWorkCount > 0 ? 'warn' : undefined}>
          <OperationalList items={view.overdueWork} timezone={timezone} empty="No overdue work." />
        </Panel>
        <Panel id="upcoming" title="Upcoming deadlines" lede="The next deadline in each matching project.">
          <OperationalList items={view.upcomingDeadlines} timezone={timezone} empty="No upcoming deadlines." />
        </Panel>
        <Panel id="outstanding" title="Outstanding invoices" lede={plural(view.issuedInvoices, 'issued invoice', 'issued invoices')}>
          <Outstanding view={view} />
        </Panel>
      </section>
      <Figures view={view} />
      {rows.length > 0 && <Requests rows={rows} timezone={timezone} />}
    </>
  );
}

/** Where the matching projects are in their lifecycle; each stage filters the dashboard to it. */
function Pipeline({ view }: { view: ProjectOpsDashboardView }) {
  return (
    <nav className="pipeline" aria-label="Projects by status">
      <ol>
        {dashboardStatuses.map(status => {
          const count = view.byStatus[status] ?? 0;
          return (
            <li key={status} data-status={status} className={count === 0 ? 'pipeline-empty' : undefined}>
              <a href={dashboardHref({ q: view.filter.q, status })} aria-current={view.filter.status === status ? 'true' : undefined}>
                <span className="pipeline-count">{count}</span>
                <span className="pipeline-label">{statusLabel(status)}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function EmptyState({ hasEligibleProjects }: { hasEligibleProjects: boolean }) {
  return hasEligibleProjects ? (
    <div className="empty-state">
      <h2>No matching projects</h2>
      <p>Change the search or status, or <a href="/projectops">reset the filters</a>.</p>
    </div>
  ) : (
    <div className="empty-state">
      <h2>No active project requests yet</h2>
      <p>Projects appear here once a client has one. <a href="/projectops/client-management">Open clients</a> to add a project request.</p>
    </div>
  );
}

function Panel({ id, title, lede, tone, children }: { id: string; title: string; lede: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <section id={id} className={`panel${tone ? ` panel-${tone}` : ''}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="panel-lede">{lede}</p>
      {children}
    </section>
  );
}

const KIND_SECTION = { task: 'tasks', milestone: 'milestones', project: undefined } as const;
const KIND_LABEL = { task: 'Task', milestone: 'Milestone', project: 'Project deadline' } as const;

const LIST_PREVIEW = 5;

/** The first few entries, with the rest one click away, so one busy list cannot push the page down. */
function useCollapsed<T>(items: readonly T[]): [readonly T[], ReactNode] {
  const [open, setOpen] = useState(false);
  const hidden = items.length - LIST_PREVIEW;
  if (open || hidden <= 0) return [items, null];
  return [items.slice(0, LIST_PREVIEW), <button type="button" className="list-more" onClick={() => setOpen(true)}>Show {hidden} more</button>];
}

function OperationalList({ items, timezone, empty }: { items: readonly DashboardOperationalItem[]; timezone: string; empty: string }) {
  const [shown, more] = useCollapsed(items);
  if (items.length === 0) return <p className="panel-empty">{empty}</p>;
  return (
    <>
    <ul className="item-list">
      {shown.map(item => (
        <li key={`${item.projectRequestId}:${item.kind}:${item.id}`}>
          <a href={projectHref(item.projectRequestId, KIND_SECTION[item.kind])}>
            {item.kind === 'project' ? item.projectTitle : item.title}
          </a>
          <span className="item-context">
            {item.kind === 'project' ? KIND_LABEL.project : `${KIND_LABEL[item.kind]} in ${item.projectTitle}`}
            {item.count > 1 ? `, ${item.count} due` : ''}
          </span>
          <time className="item-due" dateTime={item.dueAtIso}>{formatDateTime(item.dueAtIso, timezone)}</time>
        </li>
      ))}
    </ul>
    {more}
    </>
  );
}

function currencies(totals: ProjectFinanceTotalsByCurrency, key?: keyof ProjectFinanceTotals): string[] {
  return Object.keys(totals).sort().filter(currency => !key || BigInt(totals[currency]![key]) !== 0n);
}

function Outstanding({ view }: { view: ProjectOpsDashboardView }) {
  const invoiced = view.rows.filter(row => (row.issuedInvoiceCount ?? 0) > 0);
  const [shown, more] = useCollapsed(invoiced);
  if (invoiced.length === 0) return <p className="panel-empty">No outstanding invoices.</p>;
  const owed = currencies(view.financeTotalsByCurrency, 'outstandingInvoiceAmountCents');
  return (
    <>
      <ul className="money-list" aria-label="Outstanding by currency">
        {owed.length === 0 ? <li>Nothing outstanding</li> : owed.map(currency => (
          <li key={currency}>{formatFinanceCents(view.financeTotalsByCurrency[currency]!.outstandingInvoiceAmountCents, currency)}</li>
        ))}
      </ul>
      <ul className="item-list">
        {shown.map(row => {
          const rowOwed = currencies(row.financeTotalsByCurrency ?? {}, 'outstandingInvoiceAmountCents');
          return (
            <li key={row.id}>
              <a href={projectHref(row.id, 'invoices')}>Invoices for {row.title}</a>
              <span className="item-context">
                {plural(row.issuedInvoiceCount ?? 0, 'issued', 'issued')}
                {rowOwed.length > 0 ? `, ${rowOwed.map(currency => formatFinanceCents(row.financeTotalsByCurrency![currency]!.outstandingInvoiceAmountCents, currency)).join(', ')} outstanding` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {more}
    </>
  );
}

function Figures({ view }: { view: ProjectOpsDashboardView }) {
  const figures: [string, number | string, string?][] = [
    ['Active projects', view.totalActiveRequests, view.highPriorityOpen ? `${view.highPriorityOpen} high priority` : undefined],
    ['Open tasks', view.openTasks, view.highOpenTasks ? `${view.highOpenTasks} high priority` : undefined],
    ['Open milestones', view.openMilestones, `${view.completedMilestones} completed`],
    ['Open issues', view.openIssues, view.highOpenIssues ? `${view.highOpenIssues} high impact` : undefined],
    ['Open risks', view.openRisks, view.highOpenRisks ? `${view.highOpenRisks} high` : undefined],
    ['Open feedback', view.openFeedback, view.negativeOpenFeedback ? `${view.negativeOpenFeedback} negative` : undefined],
    ['Billable time', formatHours(view.billableWorkMinutes), `${formatHours(view.nonBillableWorkMinutes)} non-billable`],
  ];
  const money = currencies(view.financeTotalsByCurrency);
  return (
    <section className="figures" aria-labelledby="figures-title">
      <h2 id="figures-title">Work and money</h2>
      <dl className="metrics">
        {figures.map(([label, value, detail]) => (
          <div className="metric" key={label}>
            <dt>{label}</dt>
            <dd><span className="metric-value">{value}</span>{detail && <span className="metric-detail">{detail}</span>}</dd>
          </div>
        ))}
      </dl>
      {money.length > 0 && (
        <div className="table-scroll">
          <table className="money-table">
            <caption>Money by currency, never converted</caption>
            <thead><tr><th scope="col">Currency</th><th scope="col">Outstanding invoices</th><th scope="col">Paid invoices</th><th scope="col">Expenses submitted</th><th scope="col">Expenses approved</th></tr></thead>
            <tbody>
              {money.map(currency => (
                <tr key={currency}>
                  <th scope="row">{currency}</th>
                  {financeTotalKeys.map(key => <td key={key}>{formatFinanceCents(view.financeTotalsByCurrency[currency]![key], currency)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function nextDeadline(row: ProjectOpsDashboardRow): string | undefined {
  return [row.nextUpcomingTask?.dueAtIso, row.nextUpcomingMilestone?.dueAtIso, row.deadlineIso]
    .filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function Requests({ rows, timezone }: { rows: readonly ProjectOpsDashboardRow[]; timezone: string }) {
  return (
    <section className="requests" aria-labelledby="active-requests-title">
      <h2 id="active-requests-title">Active projects</h2>
      <div className="table-scroll">
        <table className="requests-table">
          <thead>
            <tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Estimate</th><th scope="col">Next deadline</th><th scope="col">Open work</th><th scope="col">Invoices</th><th scope="col">Needs attention</th></tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const due = nextDeadline(row);
              const overdue = (row.overdueTaskCount ?? 0) + (row.overdueMilestoneCount ?? 0);
              const flags = [
                overdue ? plural(overdue, 'overdue item', 'overdue items') : '',
                row.highOpenIssueCount ? plural(row.highOpenIssueCount, 'high issue', 'high issues') : '',
                row.highOpenRiskCount ? plural(row.highOpenRiskCount, 'high risk', 'high risks') : '',
                row.negativeOpenFeedbackCount ? plural(row.negativeOpenFeedbackCount, 'negative feedback', 'negative feedback') : '',
              ].filter(Boolean);
              return (
                <tr key={row.id}>
                  <th scope="row">
                    <a href={projectHref(row.id)}>{row.title}</a>
                    <span className="cell-detail">{row.clientName}{row.priority === 'high' ? ', high priority' : ''}</span>
                  </th>
                  <td><span className="status-chip" data-status={row.status}>{statusLabel(row.status)}</span></td>
                  <td>{row.estimateAmountCents !== undefined && row.estimateCurrency ? formatFinanceCents(row.estimateAmountCents, row.estimateCurrency) : <span className="cell-muted">None yet</span>}</td>
                  <td>{due ? <time dateTime={due}>{formatDateTime(due, timezone)}</time> : <span className="cell-muted">None</span>}</td>
                  <td>{plural(row.openTaskCount ?? 0, 'task', 'tasks')}<span className="cell-detail">{plural(row.openMilestoneCount ?? 0, 'milestone', 'milestones')}</span></td>
                  <td>{row.paidInvoiceCount ?? 0} paid<span className="cell-detail">{row.issuedInvoiceCount ?? 0} unpaid</span></td>
                  <td>{flags.length ? <span className="cell-flags">{flags.join(', ')}</span> : <span className="cell-muted">Nothing</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
