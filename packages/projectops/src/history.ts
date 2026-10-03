import type { ProjectActivityEventType } from './domain.ts';

/** Trusted request-local context, supplied by the protected API, never by its payload. */
export interface ProjectHistoryContext {
  readonly actor: string;
  readonly clock: () => string;
  readonly activityId?: () => string;
}

export const projectHistoryLabels = Object.freeze({
  request_created: 'Project created', request_edited: 'Project edited',
  request_estimated: 'Project estimated', request_approved: 'Project approved',
  status_changed: 'Project status changed',
  milestone_created: 'Milestone created', milestone_edited: 'Milestone edited',
  milestone_completed: 'Milestone completed', milestone_reopened: 'Milestone reopened',
  task_created: 'Task created', task_edited: 'Task edited',
  task_completed: 'Task completed', task_reopened: 'Task reopened',
  work_log_added: 'Work log added', note_added: 'Note added', note_archived: 'Note archived',
  issue_created: 'Issue created', issue_resolved: 'Issue resolved',
  risk_created: 'Risk created', risk_mitigated: 'Risk mitigated',
  document_added: 'Document added', document_archived: 'Document archived',
  deliverable_submitted: 'Deliverable submitted', deliverable_accepted: 'Deliverable accepted',
  feedback_added: 'Feedback added', feedback_addressed: 'Feedback addressed',
  invoice_issued: 'Invoice issued', invoice_paid: 'Invoice paid',
  expense_submitted: 'Expense submitted', expense_approved: 'Expense approved',
  expense_rejected: 'Expense rejected', operator_annotation: 'Operator annotation',
} satisfies Record<ProjectActivityEventType, string>);

/** Resource identifiers are bounded to 80 characters; summaries contain no raw user bodies. */
export function projectHistorySummary(
  eventType: ProjectActivityEventType,
  result: { readonly id: string; readonly status?: string },
  previousStatus?: string
): string {
  return `${projectHistoryLabels[eventType]}: ${result.id}${eventType === 'status_changed' ? ` (${previousStatus} → ${result.status})` : ''}.`;
}
