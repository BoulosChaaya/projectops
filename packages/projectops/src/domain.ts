export type ClientStatus = 'active' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectMilestoneStatus = 'open' | 'completed';
export type ProjectDeliverableStatus = 'submitted' | 'accepted';
export type ProjectInvoiceStatus = 'issued' | 'paid';
export type ProjectChangeRequestStatus = 'proposed' | 'approved' | 'rejected';
export type ProjectIssueStatus = 'open' | 'resolved';
export type ProjectIssueSeverity = 'low' | 'medium' | 'high';
export type ProjectRiskStatus = 'open' | 'mitigated';
export type ProjectRiskLevel = 'low' | 'medium' | 'high';
export type ProjectFeedbackStatus = 'open' | 'addressed';
export type ProjectFeedbackSentiment = 'positive' | 'neutral' | 'negative';
export type ProjectDocumentStatus = 'active' | 'archived';
export type ProjectDocumentType = 'proposal' | 'contract' | 'asset' | 'handoff' | 'other';
export type ProjectNoteStatus = 'active' | 'archived';
export type ProjectNoteVisibility = 'internal' | 'client';
export type ProjectTaskStatus = 'open' | 'completed';
export type ProjectTaskPriority = 'low' | 'medium' | 'high';
export type ProjectWorkLogBillable = boolean;
export type ProjectExpenseStatus = 'submitted' | 'approved' | 'rejected';
export type ProjectExpenseCategory = 'software' | 'asset' | 'service' | 'travel' | 'other';
export type ProjectActivityEventType =
  | 'request_created'
  | 'request_estimated'
  | 'request_approved'
  | 'status_changed'
  | 'milestone_created'
  | 'milestone_completed'
  | 'deliverable_submitted'
  | 'deliverable_accepted'
  | 'invoice_issued'
  | 'invoice_paid'
  | 'note_added';
export type ProjectRequestStatus =
  | 'new'
  | 'estimated'
  | 'approved'
  | 'in_progress'
  | 'on_hold'
  | 'cancelled'
  | 'delivered'
  | 'archived';

export interface ProjectOpsClient {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly status: ClientStatus;
  readonly createdAtIso: string;
  readonly revision?: number;
}

export interface ClientFilter {
  readonly q?: string;
  readonly status?: 'active' | 'archived' | 'all';
}
export interface EditClientInput {
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly expectedRevision: number;
}
export function validateClientFilter(filter: ClientFilter = {}): Required<ClientFilter> {
  const q = filter.q ?? '';
  const status = filter.status ?? 'all';
  if (typeof q !== 'string' || q.length > 120 || !['active', 'archived', 'all'].includes(status)) {
    throw new ProjectOpsValidationError('INVALID_CLIENT_FILTER', 'Invalid client search or status filter.');
  }
  return { q: q.trim().toLowerCase(), status };
}
export function validateClientRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= 2147483647) {
    throw new ProjectOpsValidationError('INVALID_CLIENT_REVISION', 'A valid client revision is required.');
  }
  return value;
}
export function editClient(client: ProjectOpsClient, input: EditClientInput): ProjectOpsClient {
  validateClientRevision(input.expectedRevision);
  return Object.freeze({ ...client,
    name: requireText('client.name', input.name, 120),
    contactName: optionalText('client.contactName', input.contactName, 120),
    email: optionalEmail('client.email', input.email),
  });
}

export interface ProjectRequest {
  readonly revision?: number;
  readonly id: string;
  readonly clientId: string;
  readonly title: string;
  readonly brief: string;
  readonly budgetRange?: string;
  readonly deadlineIso?: string;
  readonly estimateAmountCents?: number;
  readonly estimateCurrency?: string;
  readonly estimatedAtIso?: string;
  readonly approvedAtIso?: string;
  readonly approvedBy?: string;
  readonly priority: ProjectPriority;
  readonly status: ProjectRequestStatus;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

export interface EditProjectInput {
  readonly title: string;
  readonly brief: string;
  readonly budgetRange?: string;
  readonly deadlineIso?: string;
  readonly priority: ProjectPriority;
  readonly expectedRevision: number;
}
export function editProject(request: ProjectRequest, input: EditProjectInput, nowIso: string): ProjectRequest {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 2147483647) {
    throw new ProjectOpsValidationError('INVALID_PROJECT_REVISION', 'A valid project revision is required.');
  }
  const validated = createProjectRequest({ id: request.id, clientId: request.clientId,
    title: input.title, brief: input.brief, budgetRange: input.budgetRange, deadlineIso: input.deadlineIso,
    priority: input.priority, createdAtIso: request.createdAtIso });
  return Object.freeze({ ...request, title: validated.title, brief: validated.brief,
    budgetRange: validated.budgetRange, deadlineIso: validated.deadlineIso, priority: validated.priority,
    updatedAtIso: assertIsoTimestamp('projectRequest.updatedAtIso', nowIso) });
}

export interface ProjectMilestone {
  readonly revision?: number;
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly dueAtIso?: string;
  readonly status: ProjectMilestoneStatus;
  readonly createdAtIso: string;
  readonly completedAtIso?: string;
  readonly updatedAtIso: string;
}

export interface ProjectDeliverable {
  readonly id: string;
  readonly projectRequestId: string;
  readonly milestoneId?: string;
  readonly title: string;
  readonly artifactUrl: string;
  readonly status: ProjectDeliverableStatus;
  readonly submittedAtIso: string;
  readonly acceptedAtIso?: string;
  readonly updatedAtIso: string;
}

export interface ProjectInvoice {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly invoiceNumber: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: ProjectInvoiceStatus;
  readonly issuedAtIso: string;
  readonly dueAtIso?: string;
  readonly paidAtIso?: string;
  readonly updatedAtIso: string;
}

export interface ProjectChangeRequest {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly requestedBy: string;
  readonly estimateDeltaCents?: number;
  readonly estimateCurrency?: string;
  readonly status: ProjectChangeRequestStatus;
  readonly requestedAtIso: string;
  readonly decidedAtIso?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
  readonly updatedAtIso: string;
}

export interface ProjectIssue {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: ProjectIssueSeverity;
  readonly owner?: string;
  readonly status: ProjectIssueStatus;
  readonly openedAtIso: string;
  readonly resolvedAtIso?: string;
  readonly resolutionNote?: string;
  readonly updatedAtIso: string;
}

export interface ProjectRisk {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly probability: ProjectRiskLevel;
  readonly impact: ProjectRiskLevel;
  readonly mitigationPlan?: string;
  readonly owner?: string;
  readonly status: ProjectRiskStatus;
  readonly identifiedAtIso: string;
  readonly mitigatedAtIso?: string;
  readonly mitigationNote?: string;
  readonly updatedAtIso: string;
}

export interface ProjectFeedback {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly author: string;
  readonly sentiment: ProjectFeedbackSentiment;
  readonly message: string;
  readonly status: ProjectFeedbackStatus;
  readonly receivedAtIso: string;
  readonly addressedAtIso?: string;
  readonly addressedBy?: string;
  readonly responseNote?: string;
  readonly updatedAtIso: string;
}

export interface ProjectDocument {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly title: string;
  readonly documentType: ProjectDocumentType;
  readonly url: string;
  readonly status: ProjectDocumentStatus;
  readonly uploadedBy: string;
  readonly uploadedAtIso: string;
  readonly archivedAtIso?: string;
  readonly archivedBy?: string;
  readonly updatedAtIso: string;
}

export interface ProjectNote {
  readonly id: string;
  readonly projectRequestId: string;
  readonly author: string;
  readonly visibility: ProjectNoteVisibility;
  readonly body: string;
  readonly status: ProjectNoteStatus;
  readonly createdAtIso: string;
  readonly archivedAtIso?: string;
  readonly archivedBy?: string;
  readonly updatedAtIso: string;
}

export interface ProjectTask {
  readonly revision?: number;
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description?: string;
  readonly assignee?: string;
  readonly priority: ProjectTaskPriority;
  readonly status: ProjectTaskStatus;
  readonly dueAtIso?: string;
  readonly createdAtIso: string;
  readonly completedAtIso?: string;
  readonly completedBy?: string;
  readonly updatedAtIso: string;
}

export interface ProjectWorkLog {
  readonly id: string;
  readonly projectRequestId: string;
  readonly taskId?: string;
  readonly actor: string;
  readonly minutes: number;
  readonly billable: ProjectWorkLogBillable;
  readonly note?: string;
  readonly loggedAtIso: string;
  readonly createdAtIso: string;
}

export interface ProjectExpense {
  readonly id: string;
  readonly projectRequestId: string;
  readonly category: ProjectExpenseCategory;
  readonly description: string;
  readonly vendor?: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly reimbursable: boolean;
  readonly receiptUrl?: string;
  readonly status: ProjectExpenseStatus;
  readonly incurredAtIso: string;
  readonly decidedAtIso?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
  readonly updatedAtIso: string;
}

export interface ProjectActivity {
  readonly id: string;
  readonly projectRequestId: string;
  readonly eventType: ProjectActivityEventType;
  readonly summary: string;
  readonly actor?: string;
  readonly happenedAtIso: string;
  readonly createdAtIso: string;
}

export interface NewClientInput {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly createdAtIso: string;
}

export interface NewProjectRequestInput {
  readonly id: string;
  readonly clientId: string;
  readonly title: string;
  readonly brief: string;
  readonly budgetRange?: string;
  readonly deadlineIso?: string;
  readonly priority?: ProjectPriority;
  readonly createdAtIso: string;
}

export interface EstimateProjectRequestInput {
  readonly expectedRevision?: number;
  readonly amountCents: number;
  readonly currency: string;
  readonly estimatedAtIso: string;
}

export interface ApproveProjectRequestInput {
  readonly expectedRevision?: number;
  readonly approvedBy: string;
  readonly approvedAtIso: string;
}

export interface NewProjectMilestoneInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly dueAtIso?: string;
  readonly createdAtIso: string;
}

export interface EditProjectMilestoneInput {
  readonly title: string;
  readonly dueAtIso?: string;
  readonly expectedRevision: number;
}

export interface CompleteProjectMilestoneInput {
  readonly completedAtIso: string;
  readonly expectedRevision?: number;
}

export interface ReopenProjectMilestoneInput {
  readonly reopenedAtIso: string;
  readonly expectedRevision: number;
}

export interface NewProjectDeliverableInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly milestoneId?: string;
  readonly title: string;
  readonly artifactUrl: string;
  readonly submittedAtIso: string;
}

export interface NewProjectInvoiceInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly invoiceNumber: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly issuedAtIso: string;
  readonly dueAtIso?: string;
}

export interface NewProjectChangeRequestInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly requestedBy: string;
  readonly estimateDeltaCents?: number;
  readonly estimateCurrency?: string;
  readonly requestedAtIso: string;
}

export interface DecideProjectChangeRequestInput {
  readonly decidedBy: string;
  readonly decidedAtIso: string;
  readonly decisionNote?: string;
}

export interface NewProjectIssueInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly severity?: ProjectIssueSeverity;
  readonly owner?: string;
  readonly openedAtIso: string;
}

export interface ResolveProjectIssueInput {
  readonly resolvedAtIso: string;
  readonly resolutionNote?: string;
}

export interface NewProjectRiskInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly probability?: ProjectRiskLevel;
  readonly impact?: ProjectRiskLevel;
  readonly mitigationPlan?: string;
  readonly owner?: string;
  readonly identifiedAtIso: string;
}

export interface MitigateProjectRiskInput {
  readonly mitigatedAtIso: string;
  readonly mitigationNote?: string;
}

export interface NewProjectFeedbackInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly author: string;
  readonly sentiment?: ProjectFeedbackSentiment;
  readonly message: string;
  readonly receivedAtIso: string;
}

export interface AddressProjectFeedbackInput {
  readonly addressedBy: string;
  readonly addressedAtIso: string;
  readonly responseNote?: string;
}

export interface NewProjectDocumentInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly title: string;
  readonly documentType?: ProjectDocumentType;
  readonly url: string;
  readonly uploadedBy: string;
  readonly uploadedAtIso: string;
}

export interface ArchiveProjectDocumentInput {
  readonly archivedBy: string;
  readonly archivedAtIso: string;
}

export interface NewProjectNoteInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly author: string;
  readonly visibility?: ProjectNoteVisibility;
  readonly body: string;
  readonly createdAtIso: string;
}

export interface ArchiveProjectNoteInput {
  readonly archivedBy: string;
  readonly archivedAtIso: string;
}

export interface NewProjectTaskInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description?: string;
  readonly assignee?: string;
  readonly priority?: ProjectTaskPriority;
  readonly dueAtIso?: string;
  readonly createdAtIso: string;
}

export interface EditProjectTaskInput {
  readonly title: string;
  readonly description?: string;
  readonly assignee?: string;
  readonly priority: ProjectTaskPriority;
  readonly dueAtIso?: string;
  readonly expectedRevision: number;
}

export interface CompleteProjectTaskInput {
  readonly completedBy: string;
  readonly completedAtIso: string;
  readonly expectedRevision?: number;
}

export interface ReopenProjectTaskInput {
  readonly reopenedAtIso: string;
  readonly expectedRevision: number;
}

export interface NewProjectWorkLogInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly taskId?: string;
  readonly actor: string;
  readonly minutes: number;
  readonly billable?: ProjectWorkLogBillable;
  readonly note?: string;
  readonly loggedAtIso: string;
}

export interface NewProjectExpenseInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly category?: ProjectExpenseCategory;
  readonly description: string;
  readonly vendor?: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly reimbursable?: boolean;
  readonly receiptUrl?: string;
  readonly incurredAtIso: string;
}

export interface DecideProjectExpenseInput {
  readonly decidedBy: string;
  readonly decidedAtIso: string;
  readonly decisionNote?: string;
}

export interface NewProjectActivityInput {
  readonly id: string;
  readonly projectRequestId: string;
  readonly eventType: ProjectActivityEventType;
  readonly summary: string;
  readonly actor?: string;
  readonly happenedAtIso: string;
}

export class ProjectOpsValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectOpsValidationError';
    this.code = code;
  }
}

export type ProjectOpsOperationErrorKind = 'conflict' | 'not_found' | 'invalid_state';

export class ProjectOpsOperationError extends Error {
  readonly code: string;
  readonly kind: ProjectOpsOperationErrorKind;

  constructor(kind: ProjectOpsOperationErrorKind, code: string, message: string) {
    super(message);
    this.name = 'ProjectOpsOperationError';
    this.kind = kind;
    this.code = code;
  }
}

export const projectRequestStatuses = Object.freeze([
  'new',
  'estimated',
  'approved',
  'in_progress',
  'on_hold',
  'cancelled',
  'delivered',
  'archived',
] satisfies readonly ProjectRequestStatus[]);

export const projectPriorities = Object.freeze([
  'low',
  'medium',
  'high',
] satisfies readonly ProjectPriority[]);

export const projectMilestoneStatuses = Object.freeze([
  'open',
  'completed',
] satisfies readonly ProjectMilestoneStatus[]);

export const projectDeliverableStatuses = Object.freeze([
  'submitted',
  'accepted',
] satisfies readonly ProjectDeliverableStatus[]);

export const projectInvoiceStatuses = Object.freeze([
  'issued',
  'paid',
] satisfies readonly ProjectInvoiceStatus[]);

export const projectChangeRequestStatuses = Object.freeze([
  'proposed',
  'approved',
  'rejected',
] satisfies readonly ProjectChangeRequestStatus[]);

export const projectIssueStatuses = Object.freeze([
  'open',
  'resolved',
] satisfies readonly ProjectIssueStatus[]);

export const projectIssueSeverities = Object.freeze([
  'low',
  'medium',
  'high',
] satisfies readonly ProjectIssueSeverity[]);

export const projectRiskStatuses = Object.freeze([
  'open',
  'mitigated',
] satisfies readonly ProjectRiskStatus[]);

export const projectRiskLevels = Object.freeze([
  'low',
  'medium',
  'high',
] satisfies readonly ProjectRiskLevel[]);

export const projectFeedbackStatuses = Object.freeze([
  'open',
  'addressed',
] satisfies readonly ProjectFeedbackStatus[]);

export const projectFeedbackSentiments = Object.freeze([
  'positive',
  'neutral',
  'negative',
] satisfies readonly ProjectFeedbackSentiment[]);

export const projectDocumentStatuses = Object.freeze([
  'active',
  'archived',
] satisfies readonly ProjectDocumentStatus[]);

export const projectDocumentTypes = Object.freeze([
  'proposal',
  'contract',
  'asset',
  'handoff',
  'other',
] satisfies readonly ProjectDocumentType[]);

export const projectNoteStatuses = Object.freeze([
  'active',
  'archived',
] satisfies readonly ProjectNoteStatus[]);

export const projectNoteVisibilities = Object.freeze([
  'internal',
  'client',
] satisfies readonly ProjectNoteVisibility[]);

export const projectTaskStatuses = Object.freeze([
  'open',
  'completed',
] satisfies readonly ProjectTaskStatus[]);

export const projectTaskPriorities = Object.freeze([
  'low',
  'medium',
  'high',
] satisfies readonly ProjectTaskPriority[]);

export const projectExpenseStatuses = Object.freeze([
  'submitted',
  'approved',
  'rejected',
] satisfies readonly ProjectExpenseStatus[]);

export const projectExpenseCategories = Object.freeze([
  'software',
  'asset',
  'service',
  'travel',
  'other',
] satisfies readonly ProjectExpenseCategory[]);

export const projectActivityEventTypes = Object.freeze([
  'request_created',
  'request_estimated',
  'request_approved',
  'status_changed',
  'milestone_created',
  'milestone_completed',
  'deliverable_submitted',
  'deliverable_accepted',
  'invoice_issued',
  'invoice_paid',
  'note_added',
] satisfies readonly ProjectActivityEventType[]);

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const workflowTransitions: Readonly<Record<ProjectRequestStatus, readonly ProjectRequestStatus[]>> =
  Object.freeze({
    new: Object.freeze(['estimated', 'cancelled']),
    estimated: Object.freeze(['estimated', 'approved', 'cancelled']),
    approved: Object.freeze(['in_progress', 'cancelled']),
    in_progress: Object.freeze(['on_hold', 'delivered', 'cancelled']),
    on_hold: Object.freeze(['in_progress', 'cancelled']),
    cancelled: Object.freeze(['archived']),
    delivered: Object.freeze(['archived']),
    archived: Object.freeze([]),
  });

export function createClient(input: NewClientInput): ProjectOpsClient {
  const id = requireIdentifier('client.id', input.id);
  const name = requireText('client.name', input.name, 120);
  const contactName = optionalText('client.contactName', input.contactName, 120);
  const email = optionalEmail('client.email', input.email);

  return Object.freeze({
    id,
    name,
    contactName,
    email,
    status: 'active',
    revision: 1,
    createdAtIso: assertIsoTimestamp('client.createdAtIso', input.createdAtIso),
  });
}

export function createProjectRequest(input: NewProjectRequestInput): ProjectRequest {
  const id = requireIdentifier('projectRequest.id', input.id);
  const clientId = requireIdentifier('projectRequest.clientId', input.clientId);
  const title = requireText('projectRequest.title', input.title, 160);
  const brief = requireText('projectRequest.brief', input.brief, 4000);
  const budgetRange = optionalText('projectRequest.budgetRange', input.budgetRange, 120);

  const priority = input.priority ?? 'medium';
  if (!projectPriorities.includes(priority)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECT_PRIORITY',
      `Unsupported project priority: ${priority}`
    );
  }

  const createdAtIso = assertIsoTimestamp('projectRequest.createdAtIso', input.createdAtIso);
  const deadlineIso = optionalIsoTimestamp('projectRequest.deadlineIso', input.deadlineIso);
  if (deadlineIso && Date.parse(deadlineIso) < Date.parse(createdAtIso)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECT_DEADLINE',
      'projectRequest.deadlineIso must not be earlier than projectRequest.createdAtIso.'
    );
  }

  return Object.freeze({
    id,
    clientId,
    title,
    brief,
    budgetRange,
    deadlineIso,
    priority,
    status: 'new',
    revision: 1,
    createdAtIso,
    updatedAtIso: createdAtIso,
  });
}

export function transitionProjectRequest(
  request: ProjectRequest,
  nextStatus: ProjectRequestStatus,
  nowIso: string
): ProjectRequest {
  if (nextStatus === 'estimated' || nextStatus === 'approved') {
    throw new ProjectOpsOperationError('invalid_state', 'PROJECTOPS_EXPLICIT_COMMAND_REQUIRED', 'Use the estimate or approval command to record required metadata.');
  }
  const transitioned = advanceProjectRequest(request, nextStatus, nowIso);
  if (['in_progress', 'on_hold', 'delivered'].includes(nextStatus)) requireProjectApproval(request);
  return transitioned;
}

function requireProjectApproval(request: ProjectRequest): void {
  if (!request.estimateAmountCents || !request.estimateCurrency || !request.estimatedAtIso || !request.approvedAtIso || !request.approvedBy) {
    throw new ProjectOpsOperationError('invalid_state', 'PROJECTOPS_APPROVAL_REQUIRED', 'A recorded estimate and approval are required before starting, holding, resuming or delivering.');
  }
}

function advanceProjectRequest(request: ProjectRequest, nextStatus: ProjectRequestStatus, nowIso: string): ProjectRequest {
  const allowed = workflowTransitions[request.status];
  if (!allowed.includes(nextStatus)) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_INVALID_STATUS_TRANSITION',
      `Illegal project request transition: ${request.status} -> ${nextStatus}.`
    );
  }

  return Object.freeze({
    ...request,
    status: nextStatus,
    updatedAtIso: assertIsoTimestamp('projectRequest.updatedAtIso', nowIso),
  });
}

export function estimateProjectRequest(
  request: ProjectRequest,
  input: EstimateProjectRequestInput
): ProjectRequest {
  const estimated = advanceProjectRequest(request, 'estimated', input.estimatedAtIso);
  return Object.freeze({
    ...estimated,
    estimateAmountCents: requireMoneyCents('projectRequest.estimateAmountCents', input.amountCents),
    estimateCurrency: requireCurrency('projectRequest.estimateCurrency', input.currency),
    estimatedAtIso: assertIsoTimestamp('projectRequest.estimatedAtIso', input.estimatedAtIso),
  });
}

export function approveProjectRequest(
  request: ProjectRequest,
  input: ApproveProjectRequestInput
): ProjectRequest {
  if (request.estimateAmountCents === undefined || !request.estimateCurrency || !request.estimatedAtIso) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_ESTIMATE_REQUIRED',
      'Project request must be estimated before approval.'
    );
  }

  const approved = advanceProjectRequest(request, 'approved', input.approvedAtIso);
  return Object.freeze({
    ...approved,
    approvedAtIso: assertIsoTimestamp('projectRequest.approvedAtIso', input.approvedAtIso),
    approvedBy: requireText('projectRequest.approvedBy', input.approvedBy, 120),
  });
}

export function createProjectMilestone(
  request: ProjectRequest,
  input: NewProjectMilestoneInput
): ProjectMilestone {
  if (request.status !== 'approved' && request.status !== 'in_progress') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_MILESTONES',
      'Project request must be approved or in progress before adding milestones.'
    );
  }

  const id = requireIdentifier('projectMilestone.id', input.id);
  const projectRequestId = requireIdentifier('projectMilestone.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_MILESTONE_REQUEST_MISMATCH',
      'Project milestone must belong to the selected project request.'
    );
  }

  const createdAtIso = assertIsoTimestamp('projectMilestone.createdAtIso', input.createdAtIso);
  const dueAtIso = optionalIsoTimestamp('projectMilestone.dueAtIso', input.dueAtIso);
  if (dueAtIso && Date.parse(dueAtIso) < Date.parse(createdAtIso)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECT_MILESTONE_DUE_DATE',
      'projectMilestone.dueAtIso must not be earlier than projectMilestone.createdAtIso.'
    );
  }

  return Object.freeze({
    revision: 1,
    id,
    projectRequestId,
    title: requireText('projectMilestone.title', input.title, 160),
    dueAtIso,
    status: 'open',
    createdAtIso,
    updatedAtIso: createdAtIso,
  });
}

export function editProjectMilestone(
  request: ProjectRequest,
  milestone: ProjectMilestone,
  input: EditProjectMilestoneInput,
  nowIso: string
): ProjectMilestone {
  requirePlanningRevision('milestone', input.expectedRevision);
  requireMilestoneParentState(request, 'edit');
  if (milestone.status !== 'open') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_MILESTONE_NOT_OPEN',
      'Completed milestones must be reopened before editing.'
    );
  }
  const validated = createProjectMilestone(request, {
    id: milestone.id,
    projectRequestId: milestone.projectRequestId,
    title: input.title,
    dueAtIso: input.dueAtIso,
    createdAtIso: milestone.createdAtIso,
  });
  return Object.freeze({
    ...milestone,
    title: validated.title,
    dueAtIso: validated.dueAtIso,
    updatedAtIso: assertIsoTimestamp('projectMilestone.updatedAtIso', nowIso),
  });
}

export function completeProjectMilestone(
  milestone: ProjectMilestone,
  completedAtIso: string
): ProjectMilestone {
  if (milestone.status === 'completed') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_MILESTONE_ALREADY_COMPLETED',
      'Project milestone is already completed.'
    );
  }

  const completedAt = assertIsoTimestamp('projectMilestone.completedAtIso', completedAtIso);
  return Object.freeze({
    ...milestone,
    status: 'completed',
    completedAtIso: completedAt,
    updatedAtIso: completedAt,
  });
}

export function reopenProjectMilestone(
  request: ProjectRequest,
  milestone: ProjectMilestone,
  input: ReopenProjectMilestoneInput
): ProjectMilestone {
  requirePlanningRevision('milestone', input.expectedRevision);
  requireMilestoneParentState(request, 'reopen');
  if (milestone.status !== 'completed') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_MILESTONE_NOT_COMPLETED',
      'Only completed milestones can be reopened.'
    );
  }
  const reopenedAtIso = assertIsoTimestamp('projectMilestone.reopenedAtIso', input.reopenedAtIso);
  return Object.freeze({
    ...milestone,
    status: 'open',
    completedAtIso: undefined,
    updatedAtIso: reopenedAtIso,
  });
}

export function createProjectDeliverable(
  request: ProjectRequest,
  input: NewProjectDeliverableInput
): ProjectDeliverable {
  if (request.status !== 'approved' && request.status !== 'in_progress') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_DELIVERABLES',
      'Project request must be approved or in progress before submitting deliverables.'
    );
  }

  const id = requireIdentifier('projectDeliverable.id', input.id);
  const projectRequestId = requireIdentifier('projectDeliverable.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_DELIVERABLE_REQUEST_MISMATCH',
      'Project deliverable must belong to the selected project request.'
    );
  }

  const milestoneId = optionalIdentifier('projectDeliverable.milestoneId', input.milestoneId);
  const submittedAtIso = assertIsoTimestamp('projectDeliverable.submittedAtIso', input.submittedAtIso);

  return Object.freeze({
    id,
    projectRequestId,
    milestoneId,
    title: requireText('projectDeliverable.title', input.title, 160),
    artifactUrl: requireHttpUrl('projectDeliverable.artifactUrl', input.artifactUrl),
    status: 'submitted',
    submittedAtIso,
    updatedAtIso: submittedAtIso,
  });
}

export function acceptProjectDeliverable(
  deliverable: ProjectDeliverable,
  acceptedAtIso: string
): ProjectDeliverable {
  if (deliverable.status === 'accepted') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_DELIVERABLE_ALREADY_ACCEPTED',
      'Project deliverable is already accepted.'
    );
  }

  const acceptedAt = assertIsoTimestamp('projectDeliverable.acceptedAtIso', acceptedAtIso);
  return Object.freeze({
    ...deliverable,
    status: 'accepted',
    acceptedAtIso: acceptedAt,
    updatedAtIso: acceptedAt,
  });
}

export function createProjectInvoice(
  request: ProjectRequest,
  input: NewProjectInvoiceInput
): ProjectInvoice {
  if (
    request.status !== 'approved' &&
    request.status !== 'in_progress' &&
    request.status !== 'delivered'
  ) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_INVOICES',
      'Project request must be approved, in progress, or delivered before issuing invoices.'
    );
  }

  const id = requireIdentifier('projectInvoice.id', input.id);
  const projectRequestId = requireIdentifier('projectInvoice.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_INVOICE_REQUEST_MISMATCH',
      'Project invoice must belong to the selected project request.'
    );
  }

  const issuedAtIso = assertIsoTimestamp('projectInvoice.issuedAtIso', input.issuedAtIso);
  const dueAtIso = optionalIsoTimestamp('projectInvoice.dueAtIso', input.dueAtIso);
  if (dueAtIso && Date.parse(dueAtIso) < Date.parse(issuedAtIso)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECT_INVOICE_DUE_DATE',
      'projectInvoice.dueAtIso must not be earlier than projectInvoice.issuedAtIso.'
    );
  }

  return Object.freeze({
    id,
    projectRequestId,
    deliverableId: optionalIdentifier('projectInvoice.deliverableId', input.deliverableId),
    invoiceNumber: requireText('projectInvoice.invoiceNumber', input.invoiceNumber, 80),
    amountCents: requireMoneyCents('projectInvoice.amountCents', input.amountCents),
    currency: requireCurrency('projectInvoice.currency', input.currency),
    status: 'issued',
    issuedAtIso,
    dueAtIso,
    updatedAtIso: issuedAtIso,
  });
}

export function markProjectInvoicePaid(
  invoice: ProjectInvoice,
  paidAtIso: string
): ProjectInvoice {
  if (invoice.status === 'paid') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_INVOICE_ALREADY_PAID',
      'Project invoice is already paid.'
    );
  }

  const paidAt = assertIsoTimestamp('projectInvoice.paidAtIso', paidAtIso);
  return Object.freeze({
    ...invoice,
    status: 'paid',
    paidAtIso: paidAt,
    updatedAtIso: paidAt,
  });
}

export function createProjectChangeRequest(
  request: ProjectRequest,
  input: NewProjectChangeRequestInput
): ProjectChangeRequest {
  if (
    request.status !== 'approved' &&
    request.status !== 'in_progress' &&
    request.status !== 'delivered'
  ) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_CHANGE_REQUESTS',
      'Project request must be approved, in progress, or delivered before adding change requests.'
    );
  }

  const id = requireIdentifier('projectChangeRequest.id', input.id);
  const projectRequestId = requireIdentifier('projectChangeRequest.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_CHANGE_REQUEST_REQUEST_MISMATCH',
      'Project change request must belong to the selected project request.'
    );
  }

  const estimateDeltaCents = optionalMoneyCents(
    'projectChangeRequest.estimateDeltaCents',
    input.estimateDeltaCents
  );
  const estimateCurrency = optionalCurrency(
    'projectChangeRequest.estimateCurrency',
    input.estimateCurrency
  );
  if ((estimateDeltaCents === undefined) !== (estimateCurrency === undefined)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_CHANGE_REQUEST_ESTIMATE',
      'projectChangeRequest estimate delta and currency must be provided together.'
    );
  }

  const requestedAtIso = assertIsoTimestamp('projectChangeRequest.requestedAtIso', input.requestedAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    title: requireText('projectChangeRequest.title', input.title, 160),
    description: requireText('projectChangeRequest.description', input.description, 2000),
    requestedBy: requireText('projectChangeRequest.requestedBy', input.requestedBy, 120),
    estimateDeltaCents,
    estimateCurrency,
    status: 'proposed',
    requestedAtIso,
    updatedAtIso: requestedAtIso,
  });
}

export function approveProjectChangeRequest(
  changeRequest: ProjectChangeRequest,
  input: DecideProjectChangeRequestInput
): ProjectChangeRequest {
  return decideProjectChangeRequest(changeRequest, 'approved', input);
}

export function rejectProjectChangeRequest(
  changeRequest: ProjectChangeRequest,
  input: DecideProjectChangeRequestInput
): ProjectChangeRequest {
  return decideProjectChangeRequest(changeRequest, 'rejected', input);
}

export type ProjectExecutionResource = 'work_log' | 'note' | 'document' | 'issue' | 'risk';

const executionCreateStates: Readonly<Record<ProjectExecutionResource, readonly ProjectRequestStatus[]>> =
  Object.freeze({
    work_log: Object.freeze(['estimated', 'approved', 'in_progress', 'delivered']),
    note: Object.freeze(['new', 'estimated', 'approved', 'in_progress', 'on_hold', 'delivered']),
    document: Object.freeze(['estimated', 'approved', 'in_progress', 'on_hold', 'delivered']),
    issue: Object.freeze(['estimated', 'approved', 'in_progress', 'on_hold', 'delivered']),
    risk: Object.freeze(['estimated', 'approved', 'in_progress', 'on_hold', 'delivered']),
  });

const executionResourceDetails = Object.freeze({
  work_log: Object.freeze({ code: 'PROJECTOPS_REQUEST_NOT_READY_FOR_WORK_LOGS', noun: 'logging work' }),
  note: Object.freeze({ code: 'PROJECTOPS_REQUEST_NOT_READY_FOR_NOTES', noun: 'adding notes' }),
  document: Object.freeze({ code: 'PROJECTOPS_REQUEST_NOT_READY_FOR_DOCUMENTS', noun: 'adding documents' }),
  issue: Object.freeze({ code: 'PROJECTOPS_REQUEST_NOT_READY_FOR_ISSUES', noun: 'adding issues' }),
  risk: Object.freeze({ code: 'PROJECTOPS_REQUEST_NOT_READY_FOR_RISKS', noun: 'adding risks' }),
});

export function executionCreateParentStates(
  resource: ProjectExecutionResource
): readonly ProjectRequestStatus[] {
  return executionCreateStates[resource];
}

export function requireExecutionCreateParentState(
  request: ProjectRequest,
  resource: ProjectExecutionResource
): void {
  if (!executionCreateStates[resource].includes(request.status)) {
    const details = executionResourceDetails[resource];
    throw new ProjectOpsOperationError(
      'conflict',
      details.code,
      `Project state ${request.status.replaceAll('_', ' ')} does not allow ${details.noun}.`
    );
  }
}

export function requireExecutionActionParentState(request: ProjectRequest): void {
  if (request.status === 'cancelled' || request.status === 'archived') {
    throw new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_PROJECT_READ_ONLY',
      'Cancelled and archived projects are read-only.'
    );
  }
}

export function createProjectIssue(
  request: ProjectRequest,
  input: NewProjectIssueInput
): ProjectIssue {
  requireExecutionCreateParentState(request, 'issue');

  const id = requireIdentifier('projectIssue.id', input.id);
  const projectRequestId = requireIdentifier('projectIssue.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_ISSUE_REQUEST_MISMATCH',
      'Project issue must belong to the selected project request.'
    );
  }

  const severity = input.severity ?? 'medium';
  if (!projectIssueSeverities.includes(severity)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_ISSUE_SEVERITY',
      `Unsupported project issue severity: ${severity}`
    );
  }

  const openedAtIso = assertIsoTimestamp('projectIssue.openedAtIso', input.openedAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    title: requireText('projectIssue.title', input.title, 160),
    description: requireText('projectIssue.description', input.description, 2000),
    severity,
    owner: optionalText('projectIssue.owner', input.owner, 120),
    status: 'open',
    openedAtIso,
    updatedAtIso: openedAtIso,
  });
}

export function resolveProjectIssue(
  issue: ProjectIssue,
  input: ResolveProjectIssueInput
): ProjectIssue {
  if (issue.status === 'resolved') {
    throw new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_ISSUE_ALREADY_RESOLVED',
      'Project issue is already resolved.'
    );
  }

  const resolvedAtIso = assertIsoTimestamp('projectIssue.resolvedAtIso', input.resolvedAtIso);
  return Object.freeze({
    ...issue,
    status: 'resolved',
    resolvedAtIso,
    resolutionNote: optionalText('projectIssue.resolutionNote', input.resolutionNote, 500),
    updatedAtIso: resolvedAtIso,
  });
}

export function createProjectRisk(
  request: ProjectRequest,
  input: NewProjectRiskInput
): ProjectRisk {
  requireExecutionCreateParentState(request, 'risk');

  const id = requireIdentifier('projectRisk.id', input.id);
  const projectRequestId = requireIdentifier('projectRisk.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_RISK_REQUEST_MISMATCH',
      'Project risk must belong to the selected project request.'
    );
  }

  const probability = input.probability ?? 'medium';
  if (!projectRiskLevels.includes(probability)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_RISK_PROBABILITY',
      `Unsupported project risk probability: ${probability}`
    );
  }

  const impact = input.impact ?? 'medium';
  if (!projectRiskLevels.includes(impact)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_RISK_IMPACT',
      `Unsupported project risk impact: ${impact}`
    );
  }

  const identifiedAtIso = assertIsoTimestamp('projectRisk.identifiedAtIso', input.identifiedAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    title: requireText('projectRisk.title', input.title, 160),
    description: requireText('projectRisk.description', input.description, 2000),
    probability,
    impact,
    mitigationPlan: optionalText('projectRisk.mitigationPlan', input.mitigationPlan, 1000),
    owner: optionalText('projectRisk.owner', input.owner, 120),
    status: 'open',
    identifiedAtIso,
    updatedAtIso: identifiedAtIso,
  });
}

export function mitigateProjectRisk(
  risk: ProjectRisk,
  input: MitigateProjectRiskInput
): ProjectRisk {
  if (risk.status === 'mitigated') {
    throw new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_RISK_ALREADY_MITIGATED',
      'Project risk is already mitigated.'
    );
  }

  const mitigatedAtIso = assertIsoTimestamp('projectRisk.mitigatedAtIso', input.mitigatedAtIso);
  return Object.freeze({
    ...risk,
    status: 'mitigated',
    mitigatedAtIso,
    mitigationNote: optionalText('projectRisk.mitigationNote', input.mitigationNote, 500),
    updatedAtIso: mitigatedAtIso,
  });
}

export function createProjectFeedback(
  request: ProjectRequest,
  input: NewProjectFeedbackInput
): ProjectFeedback {
  if (request.status === 'new' || request.status === 'archived' || request.status === 'cancelled') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_FEEDBACK',
      'Project request must be estimated, approved, in progress, or delivered before adding feedback.'
    );
  }

  const id = requireIdentifier('projectFeedback.id', input.id);
  const projectRequestId = requireIdentifier('projectFeedback.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_FEEDBACK_REQUEST_MISMATCH',
      'Project feedback must belong to the selected project request.'
    );
  }

  const sentiment = input.sentiment ?? 'neutral';
  if (!projectFeedbackSentiments.includes(sentiment)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_FEEDBACK_SENTIMENT',
      `Unsupported project feedback sentiment: ${sentiment}`
    );
  }

  const receivedAtIso = assertIsoTimestamp('projectFeedback.receivedAtIso', input.receivedAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    deliverableId: optionalIdentifier('projectFeedback.deliverableId', input.deliverableId),
    author: requireText('projectFeedback.author', input.author, 120),
    sentiment,
    message: requireText('projectFeedback.message', input.message, 2000),
    status: 'open',
    receivedAtIso,
    updatedAtIso: receivedAtIso,
  });
}

export function addressProjectFeedback(
  feedback: ProjectFeedback,
  input: AddressProjectFeedbackInput
): ProjectFeedback {
  if (feedback.status === 'addressed') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_FEEDBACK_ALREADY_ADDRESSED',
      'Project feedback is already addressed.'
    );
  }

  const addressedAtIso = assertIsoTimestamp('projectFeedback.addressedAtIso', input.addressedAtIso);
  return Object.freeze({
    ...feedback,
    status: 'addressed',
    addressedAtIso,
    addressedBy: requireText('projectFeedback.addressedBy', input.addressedBy, 120),
    responseNote: optionalText('projectFeedback.responseNote', input.responseNote, 500),
    updatedAtIso: addressedAtIso,
  });
}

export function createProjectDocument(
  request: ProjectRequest,
  input: NewProjectDocumentInput
): ProjectDocument {
  requireExecutionCreateParentState(request, 'document');

  const id = requireIdentifier('projectDocument.id', input.id);
  const projectRequestId = requireIdentifier('projectDocument.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_DOCUMENT_REQUEST_MISMATCH',
      'Project document must belong to the selected project request.'
    );
  }

  const documentType = input.documentType ?? 'other';
  if (!projectDocumentTypes.includes(documentType)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_DOCUMENT_TYPE',
      `Unsupported project document type: ${documentType}`
    );
  }

  const uploadedAtIso = assertIsoTimestamp('projectDocument.uploadedAtIso', input.uploadedAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    deliverableId: optionalIdentifier('projectDocument.deliverableId', input.deliverableId),
    title: requireText('projectDocument.title', input.title, 160),
    documentType,
    url: requireHttpUrl('projectDocument.url', input.url),
    status: 'active',
    uploadedBy: requireText('projectDocument.uploadedBy', input.uploadedBy, 120),
    uploadedAtIso,
    updatedAtIso: uploadedAtIso,
  });
}

export function archiveProjectDocument(
  document: ProjectDocument,
  input: ArchiveProjectDocumentInput
): ProjectDocument {
  if (document.status === 'archived') {
    throw new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_DOCUMENT_ALREADY_ARCHIVED',
      'Project document is already archived.'
    );
  }

  const archivedAtIso = assertIsoTimestamp('projectDocument.archivedAtIso', input.archivedAtIso);
  return Object.freeze({
    ...document,
    status: 'archived',
    archivedAtIso,
    archivedBy: requireText('projectDocument.archivedBy', input.archivedBy, 120),
    updatedAtIso: archivedAtIso,
  });
}

export function createProjectNote(
  request: ProjectRequest,
  input: NewProjectNoteInput
): ProjectNote {
  requireExecutionCreateParentState(request, 'note');

  const id = requireIdentifier('projectNote.id', input.id);
  const projectRequestId = requireIdentifier('projectNote.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_NOTE_REQUEST_MISMATCH',
      'Project note must belong to the selected project request.'
    );
  }

  const visibility = input.visibility ?? 'internal';
  if (!projectNoteVisibilities.includes(visibility)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_NOTE_VISIBILITY',
      `Unsupported project note visibility: ${visibility}`
    );
  }

  const createdAtIso = assertIsoTimestamp('projectNote.createdAtIso', input.createdAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    author: requireText('projectNote.author', input.author, 120),
    visibility,
    body: requireText('projectNote.body', input.body, 2000),
    status: 'active',
    createdAtIso,
    updatedAtIso: createdAtIso,
  });
}

export function archiveProjectNote(
  note: ProjectNote,
  input: ArchiveProjectNoteInput
): ProjectNote {
  if (note.status === 'archived') {
    throw new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_NOTE_ALREADY_ARCHIVED',
      'Project note is already archived.'
    );
  }

  const archivedAtIso = assertIsoTimestamp('projectNote.archivedAtIso', input.archivedAtIso);
  return Object.freeze({
    ...note,
    status: 'archived',
    archivedAtIso,
    archivedBy: requireText('projectNote.archivedBy', input.archivedBy, 120),
    updatedAtIso: archivedAtIso,
  });
}

export function createProjectTask(
  request: ProjectRequest,
  input: NewProjectTaskInput
): ProjectTask {
  if (request.status === 'new' || request.status === 'archived' || request.status === 'cancelled') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_TASKS',
      'Project request must be estimated, approved, in progress, on hold, or delivered before adding tasks.'
    );
  }

  const id = requireIdentifier('projectTask.id', input.id);
  const projectRequestId = requireIdentifier('projectTask.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_TASK_REQUEST_MISMATCH',
      'Project task must belong to the selected project request.'
    );
  }

  const priority = input.priority ?? 'medium';
  if (!projectTaskPriorities.includes(priority)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_TASK_PRIORITY',
      `Unsupported project task priority: ${priority}`
    );
  }

  const createdAtIso = assertIsoTimestamp('projectTask.createdAtIso', input.createdAtIso);
  const dueAtIso = optionalIsoTimestamp('projectTask.dueAtIso', input.dueAtIso);
  if (dueAtIso && Date.parse(dueAtIso) < Date.parse(createdAtIso)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_TASK_DUE_DATE',
      'projectTask.dueAtIso must not be earlier than projectTask.createdAtIso.'
    );
  }

  return Object.freeze({
    revision: 1,
    id,
    projectRequestId,
    title: requireText('projectTask.title', input.title, 160),
    description: optionalText('projectTask.description', input.description, 1000),
    assignee: optionalText('projectTask.assignee', input.assignee, 120),
    priority,
    status: 'open',
    dueAtIso,
    createdAtIso,
    updatedAtIso: createdAtIso,
  });
}

export function editProjectTask(
  request: ProjectRequest,
  task: ProjectTask,
  input: EditProjectTaskInput,
  nowIso: string
): ProjectTask {
  requirePlanningRevision('task', input.expectedRevision);
  requireTaskParentState(request, 'edit');
  if (task.status !== 'open') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_TASK_NOT_OPEN',
      'Completed tasks must be reopened before editing.'
    );
  }
  const validated = createProjectTask(request, {
    id: task.id,
    projectRequestId: task.projectRequestId,
    title: input.title,
    description: input.description,
    assignee: input.assignee,
    priority: input.priority,
    dueAtIso: input.dueAtIso,
    createdAtIso: task.createdAtIso,
  });
  return Object.freeze({
    ...task,
    title: validated.title,
    description: validated.description,
    assignee: validated.assignee,
    priority: validated.priority,
    dueAtIso: validated.dueAtIso,
    updatedAtIso: assertIsoTimestamp('projectTask.updatedAtIso', nowIso),
  });
}

export function completeProjectTask(
  task: ProjectTask,
  input: CompleteProjectTaskInput
): ProjectTask {
  if (task.status === 'completed') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_TASK_ALREADY_COMPLETED',
      'Project task is already completed.'
    );
  }

  const completedAtIso = assertIsoTimestamp('projectTask.completedAtIso', input.completedAtIso);
  return Object.freeze({
    ...task,
    status: 'completed',
    completedAtIso,
    completedBy: requireText('projectTask.completedBy', input.completedBy, 120),
    updatedAtIso: completedAtIso,
  });
}

export function reopenProjectTask(
  request: ProjectRequest,
  task: ProjectTask,
  input: ReopenProjectTaskInput
): ProjectTask {
  requirePlanningRevision('task', input.expectedRevision);
  requireTaskParentState(request, 'reopen');
  if (task.status !== 'completed') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_TASK_NOT_COMPLETED',
      'Only completed tasks can be reopened.'
    );
  }
  const reopenedAtIso = assertIsoTimestamp('projectTask.reopenedAtIso', input.reopenedAtIso);
  return Object.freeze({
    ...task,
    status: 'open',
    completedAtIso: undefined,
    completedBy: undefined,
    updatedAtIso: reopenedAtIso,
  });
}

export function requireMilestoneParentState(
  request: ProjectRequest,
  command: 'edit' | 'complete' | 'reopen'
): void {
  const allowed = command === 'complete'
    ? ['approved', 'in_progress', 'on_hold', 'delivered']
    : ['approved', 'in_progress'];
  if (!allowed.includes(request.status)) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_MILESTONES',
      `Project state does not allow this milestone ${command} command.`
    );
  }
}

export function requireTaskParentState(
  request: ProjectRequest,
  command: 'edit' | 'complete' | 'reopen'
): void {
  if (!['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(request.status)) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_TASKS',
      `Project state does not allow this task ${command} command.`
    );
  }
}

export function requirePlanningRevision(entity: 'milestone' | 'task', value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= 2147483647) {
    throw new ProjectOpsValidationError(
      entity === 'milestone' ? 'INVALID_PROJECTOPS_MILESTONE_REVISION' : 'INVALID_PROJECTOPS_TASK_REVISION',
      `A valid ${entity} revision is required.`
    );
  }
  return value;
}

export function createProjectWorkLog(
  request: ProjectRequest,
  input: NewProjectWorkLogInput
): ProjectWorkLog {
  requireExecutionCreateParentState(request, 'work_log');

  const id = requireIdentifier('projectWorkLog.id', input.id);
  const projectRequestId = requireIdentifier('projectWorkLog.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_WORK_LOG_REQUEST_MISMATCH',
      'Project work log must belong to the selected project request.'
    );
  }

  const loggedAtIso = assertIsoTimestamp('projectWorkLog.loggedAtIso', input.loggedAtIso);
  const minutes = requireWorkMinutes('projectWorkLog.minutes', input.minutes);

  return Object.freeze({
    id,
    projectRequestId,
    taskId: optionalIdentifier('projectWorkLog.taskId', input.taskId),
    actor: requireText('projectWorkLog.actor', input.actor, 120),
    minutes,
    billable: input.billable ?? true,
    note: optionalText('projectWorkLog.note', input.note, 1000),
    loggedAtIso,
    createdAtIso: loggedAtIso,
  });
}

export function createProjectExpense(
  request: ProjectRequest,
  input: NewProjectExpenseInput
): ProjectExpense {
  if (request.status === 'new' || request.status === 'archived' || request.status === 'cancelled') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_EXPENSES',
      'Project request must be estimated, approved, in progress, or delivered before adding expenses.'
    );
  }

  const id = requireIdentifier('projectExpense.id', input.id);
  const projectRequestId = requireIdentifier('projectExpense.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_EXPENSE_REQUEST_MISMATCH',
      'Project expense must belong to the selected project request.'
    );
  }

  const category = input.category ?? 'other';
  if (!projectExpenseCategories.includes(category)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_EXPENSE_CATEGORY',
      `Unsupported project expense category: ${category}`
    );
  }

  const incurredAtIso = assertIsoTimestamp('projectExpense.incurredAtIso', input.incurredAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    category,
    description: requireText('projectExpense.description', input.description, 500),
    vendor: optionalText('projectExpense.vendor', input.vendor, 120),
    amountCents: requireMoneyCents('projectExpense.amountCents', input.amountCents),
    currency: requireCurrency('projectExpense.currency', input.currency),
    reimbursable: input.reimbursable ?? true,
    receiptUrl: optionalHttpUrl('projectExpense.receiptUrl', input.receiptUrl),
    status: 'submitted',
    incurredAtIso,
    updatedAtIso: incurredAtIso,
  });
}

export function approveProjectExpense(
  expense: ProjectExpense,
  input: DecideProjectExpenseInput
): ProjectExpense {
  return decideProjectExpense(expense, 'approved', input);
}

export function rejectProjectExpense(
  expense: ProjectExpense,
  input: DecideProjectExpenseInput
): ProjectExpense {
  return decideProjectExpense(expense, 'rejected', input);
}

export function createProjectActivity(
  request: ProjectRequest,
  input: NewProjectActivityInput
): ProjectActivity {
  const id = requireIdentifier('projectActivity.id', input.id);
  const projectRequestId = requireIdentifier('projectActivity.projectRequestId', input.projectRequestId);
  if (projectRequestId !== request.id) {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_ACTIVITY_REQUEST_MISMATCH',
      'Project activity must belong to the selected project request.'
    );
  }

  if (!projectActivityEventTypes.includes(input.eventType)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_ACTIVITY_EVENT_TYPE',
      `Unsupported project activity event type: ${input.eventType}`
    );
  }

  const happenedAtIso = assertIsoTimestamp('projectActivity.happenedAtIso', input.happenedAtIso);
  return Object.freeze({
    id,
    projectRequestId,
    eventType: input.eventType,
    summary: requireText('projectActivity.summary', input.summary, 500),
    actor: optionalText('projectActivity.actor', input.actor, 120),
    happenedAtIso,
    createdAtIso: happenedAtIso,
  });
}

export function getAllowedProjectRequestTransitions(
  status: ProjectRequestStatus
): readonly ProjectRequestStatus[] {
  return workflowTransitions[status];
}

function requireMoneyCents(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_MONEY',
      `${name} must be a positive integer number of cents.`
    );
  }
  return value;
}

function requireWorkMinutes(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 1_440) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_WORK_MINUTES',
      `${name} must be a positive integer number of minutes up to 1440.`
    );
  }
  return value;
}

function optionalMoneyCents(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return requireMoneyCents(name, value);
}

function requireCurrency(name: string, value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_CURRENCY',
      `${name} must be a three-letter ISO currency code.`
    );
  }
  return currency;
}

function optionalCurrency(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requireCurrency(name, value);
}

function decideProjectChangeRequest(
  changeRequest: ProjectChangeRequest,
  status: Extract<ProjectChangeRequestStatus, 'approved' | 'rejected'>,
  input: DecideProjectChangeRequestInput
): ProjectChangeRequest {
  if (changeRequest.status !== 'proposed') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_CHANGE_REQUEST_ALREADY_DECIDED',
      'Project change request has already been decided.'
    );
  }

  const decidedAtIso = assertIsoTimestamp('projectChangeRequest.decidedAtIso', input.decidedAtIso);
  return Object.freeze({
    ...changeRequest,
    status,
    decidedAtIso,
    decidedBy: requireText('projectChangeRequest.decidedBy', input.decidedBy, 120),
    decisionNote: optionalText('projectChangeRequest.decisionNote', input.decisionNote, 500),
    updatedAtIso: decidedAtIso,
  });
}

function decideProjectExpense(
  expense: ProjectExpense,
  status: Extract<ProjectExpenseStatus, 'approved' | 'rejected'>,
  input: DecideProjectExpenseInput
): ProjectExpense {
  if (expense.status !== 'submitted') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_EXPENSE_ALREADY_DECIDED',
      'Project expense has already been decided.'
    );
  }

  const decidedAtIso = assertIsoTimestamp('projectExpense.decidedAtIso', input.decidedAtIso);
  return Object.freeze({
    ...expense,
    status,
    decidedAtIso,
    decidedBy: requireText('projectExpense.decidedBy', input.decidedBy, 120),
    decisionNote: optionalText('projectExpense.decisionNote', input.decisionNote, 500),
    updatedAtIso: decidedAtIso,
  });
}

function requireIdentifier(name: string, value: string): string {
  const trimmed = requireText(name, value, 80);
  if (!identifierPattern.test(trimmed)) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_IDENTIFIER',
      `${name} must start with a letter or number and contain only letters, numbers, dot, underscore, colon, or dash.`
    );
  }
  return trimmed;
}

function optionalIdentifier(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requireIdentifier(name, value);
}

function requireHttpUrl(name: string, value: string): string {
  const url = requireText(name, value, 2048);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_URL',
      `${name} must be a valid HTTP or HTTPS URL.`
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_URL',
      `${name} must be a valid HTTP or HTTPS URL.`
    );
  }
  return url;
}

function optionalHttpUrl(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requireHttpUrl(name, value);
}

function requireText(name: string, value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProjectOpsValidationError('INVALID_PROJECTOPS_TEXT', `${name} must not be empty.`);
  }
  if (trimmed.length > maxLength) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_TEXT',
      `${name} must be ${maxLength} characters or fewer.`
    );
  }
  return trimmed;
}

function assertIsoTimestamp(name: string, value: string): string {
  const trimmed = value.trim();
  if (
    Number.isNaN(Date.parse(trimmed)) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)
  ) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_TIMESTAMP',
      `${name} must be an ISO timestamp.`
    );
  }
  return trimmed;
}

function optionalIsoTimestamp(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return assertIsoTimestamp(name, value);
}

function optionalText(name: string, value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new ProjectOpsValidationError(
      'INVALID_PROJECTOPS_TEXT',
      `${name} must be ${maxLength} characters or fewer.`
    );
  }
  return trimmed;
}

function optionalEmail(name: string, value: string | undefined): string | undefined {
  const email = optionalText(name, value, 254);
  if (!email) return undefined;
  if (!emailPattern.test(email)) {
    throw new ProjectOpsValidationError('INVALID_PROJECTOPS_EMAIL', `${name} must be a valid email.`);
  }
  return email;
}
