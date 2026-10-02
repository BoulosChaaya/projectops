import type { ProjectPriority, ProjectRequestStatus } from './domain.ts';

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
  readonly outstandingInvoiceAmountCents?: number;
  readonly paidInvoiceAmountCents?: number;
  readonly proposedChangeRequestCount?: number;
  readonly approvedChangeRequestCount?: number;
  readonly rejectedChangeRequestCount?: number;
  readonly openIssueCount?: number;
  readonly highOpenIssueCount?: number;
  readonly resolvedIssueCount?: number;
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
  readonly workLogCount?: number;
  readonly billableWorkMinutes?: number;
  readonly nonBillableWorkMinutes?: number;
  readonly latestWorkLoggedAtIso?: string;
  readonly latestActivityAtIso?: string;
  readonly latestActivitySummary?: string;
  readonly updatedAtIso: string;
}

export interface ProjectOpsDashboardView {
  readonly totalActiveRequests: number;
  readonly byStatus: Readonly<Record<ProjectRequestStatus, number>>;
  readonly highPriorityOpen: number;
  readonly openMilestones: number;
  readonly completedMilestones: number;
  readonly submittedDeliverables: number;
  readonly acceptedDeliverables: number;
  readonly issuedInvoices: number;
  readonly paidInvoices: number;
  readonly outstandingInvoiceAmountCents: number;
  readonly paidInvoiceAmountCents: number;
  readonly proposedChangeRequests: number;
  readonly approvedChangeRequests: number;
  readonly rejectedChangeRequests: number;
  readonly openIssues: number;
  readonly highOpenIssues: number;
  readonly resolvedIssues: number;
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
  readonly nextDeadline?: ProjectOpsDashboardRow;
  readonly rows: readonly ProjectOpsDashboardRow[];
}

export function composeProjectOpsDashboard(
  rows: readonly ProjectOpsDashboardRow[]
): ProjectOpsDashboardView {
  const byStatus: Record<ProjectRequestStatus, number> = {
    new: 0,
    estimated: 0,
    approved: 0,
    in_progress: 0,
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
  let outstandingInvoiceAmountCents = 0;
  let paidInvoiceAmountCents = 0;
  let proposedChangeRequests = 0;
  let approvedChangeRequests = 0;
  let rejectedChangeRequests = 0;
  let openIssues = 0;
  let highOpenIssues = 0;
  let resolvedIssues = 0;
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
  let nextDeadline: ProjectOpsDashboardRow | undefined;

  for (const row of rows) {
    byStatus[row.status] += 1;
    if (row.priority === 'high' && row.status !== 'delivered' && row.status !== 'archived') {
      highPriorityOpen += 1;
    }
    openMilestones += row.openMilestoneCount ?? 0;
    completedMilestones += row.completedMilestoneCount ?? 0;
    submittedDeliverables += row.submittedDeliverableCount ?? 0;
    acceptedDeliverables += row.acceptedDeliverableCount ?? 0;
    issuedInvoices += row.issuedInvoiceCount ?? 0;
    paidInvoices += row.paidInvoiceCount ?? 0;
    outstandingInvoiceAmountCents += row.outstandingInvoiceAmountCents ?? 0;
    paidInvoiceAmountCents += row.paidInvoiceAmountCents ?? 0;
    proposedChangeRequests += row.proposedChangeRequestCount ?? 0;
    approvedChangeRequests += row.approvedChangeRequestCount ?? 0;
    rejectedChangeRequests += row.rejectedChangeRequestCount ?? 0;
    openIssues += row.openIssueCount ?? 0;
    highOpenIssues += row.highOpenIssueCount ?? 0;
    resolvedIssues += row.resolvedIssueCount ?? 0;
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
    if (row.deadlineIso && (!nextDeadline || row.deadlineIso < (nextDeadline.deadlineIso ?? ''))) {
      nextDeadline = row;
    }
  }

  return Object.freeze({
    totalActiveRequests: rows.filter((row) => row.status !== 'archived').length,
    byStatus: Object.freeze(byStatus),
    highPriorityOpen,
    openMilestones,
    completedMilestones,
    submittedDeliverables,
    acceptedDeliverables,
    issuedInvoices,
    paidInvoices,
    outstandingInvoiceAmountCents,
    paidInvoiceAmountCents,
    proposedChangeRequests,
    approvedChangeRequests,
    rejectedChangeRequests,
    openIssues,
    highOpenIssues,
    resolvedIssues,
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
    nextDeadline,
    rows: Object.freeze([...rows]),
  });
}
