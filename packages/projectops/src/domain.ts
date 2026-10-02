export type ClientStatus = 'active' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high';
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
  readonly priority: ProjectPriority;
  readonly status: ProjectRequestStatus;
  readonly createdAtIso: string;
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

export function getAllowedProjectRequestTransitions(
  status: ProjectRequestStatus
): readonly ProjectRequestStatus[] {
  return workflowTransitions[status];
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
