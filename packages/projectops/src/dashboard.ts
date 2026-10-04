import { mergeFinanceTotals, type ProjectFinanceTotalsByCurrency } from './finances.ts';
import { ProjectOpsValidationError, type ProjectPriority, type ProjectRequestStatus } from './domain.ts';

export const dashboardStatuses = Object.freeze(['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered'] as const);
export interface DashboardFilter {
  readonly q?: string;
  readonly status?: 'all' | typeof dashboardStatuses[number];
}
/** Match PostgreSQL's C.utf8 simple lowercase, independent of the database locale. */
export function dashboardSearchText(value: string): string {
  return Array.from(value, character => Array.from(character.toLowerCase())[0]).join('');
}
export function validateDashboardFilter(filter: DashboardFilter = {}): Required<DashboardFilter> {
  const q = filter.q ?? '', status = filter.status ?? 'all';
  if (typeof q !== 'string' || q.length > 120 || (status !== 'all' && !dashboardStatuses.includes(status as any))) {
    throw new ProjectOpsValidationError('INVALID_DASHBOARD_FILTER', 'Search must be at most 120 characters and status must be an eligible dashboard state.');
  }
  return Object.freeze({ q: dashboardSearchText(q.trim()), status });
}
export interface DashboardDueItem {
  readonly id: string;
  readonly title: string;
  readonly dueAtIso: string;
}
export interface DashboardOperationalItem extends DashboardDueItem {
  readonly projectRequestId: string;
  readonly projectTitle: string;
  readonly kind: 'project' | 'task' | 'milestone';
  readonly count: number;
}
export function compareOperationalItems(a: DashboardOperationalItem, b: DashboardOperationalItem): number {
  return Date.parse(a.dueAtIso) - Date.parse(b.dueAtIso) || compareIdentity(a.projectRequestId, b.projectRequestId)
    || compareIdentity(a.kind, b.kind) || compareIdentity(a.id, b.id);
}
export function compareIdentity(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export interface ProjectOpsDashboardRow {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly title: string;
  readonly priority: ProjectPriority;
  readonly status: ProjectRequestStatus;
  readonly deadlineIso?: string;
  readonly estimateAmountCents?: number;
  readonly estimateCurrency?: string;
  readonly estimatedAtIso?: string;
  readonly approvedAtIso?: string;
  readonly approvedBy?: string;
  readonly openMilestoneCount?: number;
  readonly completedMilestoneCount?: number;
  readonly submittedDeliverableCount?: number;
  readonly acceptedDeliverableCount?: number;
  readonly issuedInvoiceCount?: number;
  readonly paidInvoiceCount?: number;
  readonly proposedChangeRequestCount?: number;
  readonly approvedChangeRequestCount?: number;
  readonly rejectedChangeRequestCount?: number;
  readonly openIssueCount?: number;
  readonly highOpenIssueCount?: number;
  readonly resolvedIssueCount?: number;
  readonly openRiskCount?: number;
  readonly highOpenRiskCount?: number;
  readonly mitigatedRiskCount?: number;
  readonly openFeedbackCount?: number;
  readonly addressedFeedbackCount?: number;
  readonly negativeOpenFeedbackCount?: number;
  readonly activeDocumentCount?: number;
  readonly archivedDocumentCount?: number;
  readonly activeNoteCount?: number;
  readonly archivedNoteCount?: number;
  readonly clientVisibleNoteCount?: number;
  readonly openTaskCount?: number;
  readonly highOpenTaskCount?: number;
  readonly completedTaskCount?: number;
  readonly nextTaskDueAtIso?: string;
  readonly overdueTaskCount?: number;
  readonly overdueMilestoneCount?: number;
  readonly nextOverdueTask?: DashboardDueItem;
  readonly nextOverdueMilestone?: DashboardDueItem;
  readonly nextUpcomingTask?: DashboardDueItem;
  readonly nextUpcomingMilestone?: DashboardDueItem;
  readonly createdAtIso?: string;
  readonly workLogCount?: number;
  readonly billableWorkMinutes?: number;
  readonly nonBillableWorkMinutes?: number;
  readonly latestWorkLoggedAtIso?: string;
  readonly submittedExpenseCount?: number;
  readonly approvedExpenseCount?: number;
  readonly rejectedExpenseCount?: number;
  readonly latestActivityAtIso?: string;
  readonly latestActivitySummary?: string;
  readonly financeTotalsByCurrency?: ProjectFinanceTotalsByCurrency;
  readonly updatedAtIso: string;
}

export interface ProjectOpsDashboardView {
  readonly filter: Required<DashboardFilter>;
  readonly evaluationNow: string;
  readonly hasEligibleProjects: boolean;
  readonly overdueWorkCount: number;
  readonly overdueWork: readonly DashboardOperationalItem[];
  /** Nearest future operational deadline per matching project. */
  readonly upcomingDeadlines: readonly DashboardOperationalItem[];
  readonly totalActiveRequests: number;
  readonly byStatus: Readonly<Record<ProjectRequestStatus, number>>;
  readonly highPriorityOpen: number;
  readonly openMilestones: number;
  readonly completedMilestones: number;
  readonly submittedDeliverables: number;
  readonly acceptedDeliverables: number;
  readonly issuedInvoices: number;
  readonly paidInvoices: number;
  readonly proposedChangeRequests: number;
  readonly approvedChangeRequests: number;
  readonly rejectedChangeRequests: number;
  readonly openIssues: number;
  readonly highOpenIssues: number;
  readonly resolvedIssues: number;
  readonly openRisks: number;
  readonly highOpenRisks: number;
  readonly mitigatedRisks: number;
  readonly openFeedback: number;
  readonly addressedFeedback: number;
  readonly negativeOpenFeedback: number;
  readonly activeDocuments: number;
  readonly archivedDocuments: number;
  readonly activeNotes: number;
  readonly archivedNotes: number;
  readonly clientVisibleNotes: number;
  readonly openTasks: number;
  readonly highOpenTasks: number;
  readonly completedTasks: number;
  readonly workLogs: number;
  readonly billableWorkMinutes: number;
  readonly nonBillableWorkMinutes: number;
  readonly submittedExpenses: number;
  readonly approvedExpenses: number;
  readonly rejectedExpenses: number;
  readonly nextDeadline?: ProjectOpsDashboardRow;
  readonly financeTotalsByCurrency: ProjectFinanceTotalsByCurrency;
  readonly rows: readonly ProjectOpsDashboardRow[];
}

export function composeProjectOpsDashboard(
  rows: readonly ProjectOpsDashboardRow[],
  options: { filter?: DashboardFilter; evaluationNow?: string; hasEligibleProjects?: boolean } = {}
): ProjectOpsDashboardView {
  const filter = validateDashboardFilter(options.filter);
  const evaluationNow = options.evaluationNow ?? new Date().toISOString();
  const now = Date.parse(evaluationNow);
  if (!Number.isFinite(now)) throw new Error('Invalid dashboard evaluation instant.');
  const eligible = rows.filter(row => dashboardStatuses.includes(row.status as any));
  rows = eligible.filter(row => (filter.status === 'all' || row.status === filter.status)
    && (dashboardSearchText(row.title).includes(filter.q) || dashboardSearchText(row.clientName).includes(filter.q)));
  const overdueWork: DashboardOperationalItem[] = [], upcomingDeadlines: DashboardOperationalItem[] = [];
  for (const row of rows) {
    const item = (kind: DashboardOperationalItem['kind'], due: DashboardDueItem, count = 1): DashboardOperationalItem =>
      Object.freeze({ ...due, dueAtIso: new Date(due.dueAtIso).toISOString(), kind, count, projectRequestId: row.id, projectTitle: row.title });
    for (const [kind, due, count] of [
      ['task', row.nextOverdueTask, row.overdueTaskCount],
      ['milestone', row.nextOverdueMilestone, row.overdueMilestoneCount],
    ] as const) if (due && Date.parse(due.dueAtIso) < now) overdueWork.push(item(kind, due, count ?? 1));
    const candidates: DashboardOperationalItem[] = [];
    if (row.deadlineIso && row.status !== 'delivered' && Date.parse(row.deadlineIso) > now)
      candidates.push(item('project', { id: row.id, title: row.title, dueAtIso: row.deadlineIso }));
    for (const [kind, due] of [['task', row.nextUpcomingTask], ['milestone', row.nextUpcomingMilestone]] as const)
      if (due && Date.parse(due.dueAtIso) > now) candidates.push(item(kind, due));
    candidates.sort(compareOperationalItems);
    if (candidates[0]) upcomingDeadlines.push(candidates[0]);
  }
  overdueWork.sort(compareOperationalItems); upcomingDeadlines.sort(compareOperationalItems);
  const byStatus: Record<ProjectRequestStatus, number> = {
    new: 0,
    estimated: 0,
    approved: 0,
    in_progress: 0,
    on_hold: 0,
    cancelled: 0,
    delivered: 0,
    archived: 0,
  };

  let highPriorityOpen = 0;
  let openMilestones = 0;
  let completedMilestones = 0;
  let submittedDeliverables = 0;
  let acceptedDeliverables = 0;
  let issuedInvoices = 0;
  let paidInvoices = 0;
  let proposedChangeRequests = 0;
  let approvedChangeRequests = 0;
  let rejectedChangeRequests = 0;
  let openIssues = 0;
  let highOpenIssues = 0;
  let resolvedIssues = 0;
  let openRisks = 0;
  let highOpenRisks = 0;
  let mitigatedRisks = 0;
  let openFeedback = 0;
  let addressedFeedback = 0;
  let negativeOpenFeedback = 0;
  let activeDocuments = 0;
  let archivedDocuments = 0;
  let activeNotes = 0;
  let archivedNotes = 0;
  let clientVisibleNotes = 0;
  let openTasks = 0;
  let highOpenTasks = 0;
  let completedTasks = 0;
  let workLogs = 0;
  let billableWorkMinutes = 0;
  let nonBillableWorkMinutes = 0;
  let submittedExpenses = 0;
  let approvedExpenses = 0;
  let rejectedExpenses = 0;
  let nextDeadline: ProjectOpsDashboardRow | undefined;

  for (const row of rows) {
    byStatus[row.status] += 1;
    if (row.priority === 'high' && !['delivered', 'archived', 'cancelled'].includes(row.status)) {
      highPriorityOpen += 1;
    }
    openMilestones += row.openMilestoneCount ?? 0;
    completedMilestones += row.completedMilestoneCount ?? 0;
    submittedDeliverables += row.submittedDeliverableCount ?? 0;
    acceptedDeliverables += row.acceptedDeliverableCount ?? 0;
    issuedInvoices += row.issuedInvoiceCount ?? 0;
    paidInvoices += row.paidInvoiceCount ?? 0;
    proposedChangeRequests += row.proposedChangeRequestCount ?? 0;
    approvedChangeRequests += row.approvedChangeRequestCount ?? 0;
    rejectedChangeRequests += row.rejectedChangeRequestCount ?? 0;
    openIssues += row.openIssueCount ?? 0;
    highOpenIssues += row.highOpenIssueCount ?? 0;
    resolvedIssues += row.resolvedIssueCount ?? 0;
    openRisks += row.openRiskCount ?? 0;
    highOpenRisks += row.highOpenRiskCount ?? 0;
    mitigatedRisks += row.mitigatedRiskCount ?? 0;
    openFeedback += row.openFeedbackCount ?? 0;
    addressedFeedback += row.addressedFeedbackCount ?? 0;
    negativeOpenFeedback += row.negativeOpenFeedbackCount ?? 0;
    activeDocuments += row.activeDocumentCount ?? 0;
    archivedDocuments += row.archivedDocumentCount ?? 0;
    activeNotes += row.activeNoteCount ?? 0;
    archivedNotes += row.archivedNoteCount ?? 0;
    clientVisibleNotes += row.clientVisibleNoteCount ?? 0;
    openTasks += row.openTaskCount ?? 0;
    highOpenTasks += row.highOpenTaskCount ?? 0;
    completedTasks += row.completedTaskCount ?? 0;
    workLogs += row.workLogCount ?? 0;
    billableWorkMinutes += row.billableWorkMinutes ?? 0;
    nonBillableWorkMinutes += row.nonBillableWorkMinutes ?? 0;
    submittedExpenses += row.submittedExpenseCount ?? 0;
    approvedExpenses += row.approvedExpenseCount ?? 0;
    rejectedExpenses += row.rejectedExpenseCount ?? 0;
    if (row.deadlineIso && !['cancelled','archived','delivered'].includes(row.status) && (!nextDeadline || Date.parse(row.deadlineIso) < Date.parse(nextDeadline.deadlineIso!))) {
      nextDeadline = row;
    }
  }

  return Object.freeze({
    filter, evaluationNow: new Date(now).toISOString(), hasEligibleProjects: options.hasEligibleProjects ?? (eligible.length > 0),
    overdueWorkCount: rows.reduce((n, row) => n + (row.overdueTaskCount ?? 0) + (row.overdueMilestoneCount ?? 0), 0),
    overdueWork: Object.freeze(overdueWork), upcomingDeadlines: Object.freeze(upcomingDeadlines),
    financeTotalsByCurrency: mergeFinanceTotals(rows.map(row => row.financeTotalsByCurrency ?? {})),
    totalActiveRequests: rows.filter((row) => !['archived', 'cancelled'].includes(row.status)).length,
    byStatus: Object.freeze(byStatus),
    highPriorityOpen,
    openMilestones,
    completedMilestones,
    submittedDeliverables,
    acceptedDeliverables,
    issuedInvoices,
    paidInvoices,
    proposedChangeRequests,
    approvedChangeRequests,
    rejectedChangeRequests,
    openIssues,
    highOpenIssues,
    resolvedIssues,
    openRisks,
    highOpenRisks,
    mitigatedRisks,
    openFeedback,
    addressedFeedback,
    negativeOpenFeedback,
    activeDocuments,
    archivedDocuments,
    activeNotes,
    archivedNotes,
    clientVisibleNotes,
    openTasks,
    highOpenTasks,
    completedTasks,
    workLogs,
    billableWorkMinutes,
    nonBillableWorkMinutes,
    submittedExpenses,
    approvedExpenses,
    rejectedExpenses,
    nextDeadline,
    rows: Object.freeze([...rows]),
  });
}
