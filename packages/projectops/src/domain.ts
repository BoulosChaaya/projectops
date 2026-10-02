export type ClientStatus = 'active' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectMilestoneStatus = 'open' | 'completed';
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
