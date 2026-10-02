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
    nextDeadline,
    rows: Object.freeze([...rows]),
  });
}
