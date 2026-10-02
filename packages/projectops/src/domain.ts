export type ClientStatus = 'active' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectMilestoneStatus = 'open' | 'completed';
export type ProjectDeliverableStatus = 'submitted' | 'accepted';
export type ProjectInvoiceStatus = 'issued' | 'paid';
export type ProjectChangeRequestStatus = 'proposed' | 'approved' | 'rejected';
export type ProjectIssueStatus = 'open' | 'resolved';
export type ProjectIssueSeverity = 'low' | 'medium' | 'high';
export type ProjectFeedbackStatus = 'open' | 'addressed';
export type ProjectFeedbackSentiment = 'positive' | 'neutral' | 'negative';
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
  | 'delivered'
  | 'archived';

export interface ProjectOpsClient {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly status: ClientStatus;
  readonly createdAtIso: string;
}

export interface ProjectRequest {
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

export interface ProjectMilestone {
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
  readonly amountCents: number;
  readonly currency: string;
  readonly estimatedAtIso: string;
}

export interface ApproveProjectRequestInput {
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

export const projectFeedbackStatuses = Object.freeze([
  'open',
  'addressed',
] satisfies readonly ProjectFeedbackStatus[]);

export const projectFeedbackSentiments = Object.freeze([
  'positive',
  'neutral',
  'negative',
] satisfies readonly ProjectFeedbackSentiment[]);

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
    new: Object.freeze(['estimated']),
    estimated: Object.freeze(['approved']),
    approved: Object.freeze(['in_progress']),
    in_progress: Object.freeze(['delivered']),
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
    createdAtIso,
    updatedAtIso: createdAtIso,
  });
}

export function transitionProjectRequest(
  request: ProjectRequest,
  nextStatus: ProjectRequestStatus,
  nowIso: string
): ProjectRequest {
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
  const estimated = transitionProjectRequest(request, 'estimated', input.estimatedAtIso);
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

  const approved = transitionProjectRequest(request, 'approved', input.approvedAtIso);
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
    id,
    projectRequestId,
    title: requireText('projectMilestone.title', input.title, 160),
    dueAtIso,
    status: 'open',
    createdAtIso,
    updatedAtIso: createdAtIso,
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

export function createProjectIssue(
  request: ProjectRequest,
  input: NewProjectIssueInput
): ProjectIssue {
  if (request.status === 'new' || request.status === 'archived') {
    throw new ProjectOpsOperationError(
      'invalid_state',
      'PROJECTOPS_REQUEST_NOT_READY_FOR_ISSUES',
      'Project request must be estimated, approved, in progress, or delivered before adding issues.'
    );
  }

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
      'invalid_state',
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

export function createProjectFeedback(
  request: ProjectRequest,
  input: NewProjectFeedbackInput
): ProjectFeedback {
  if (request.status === 'new' || request.status === 'archived') {
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
