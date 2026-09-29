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
  assertNonEmpty('client.id', input.id);
  assertNonEmpty('client.name', input.name);

  return Object.freeze({
    id: input.id,
    name: input.name.trim(),
    contactName: optionalTrim(input.contactName),
    email: optionalTrim(input.email),
    status: 'active',
    createdAtIso: assertIsoTimestamp('client.createdAtIso', input.createdAtIso),
  });
}

export function createProjectRequest(input: NewProjectRequestInput): ProjectRequest {
  assertNonEmpty('projectRequest.id', input.id);
  assertNonEmpty('projectRequest.clientId', input.clientId);
  assertNonEmpty('projectRequest.title', input.title);
  assertNonEmpty('projectRequest.brief', input.brief);

  const priority = input.priority ?? 'medium';
  if (!projectPriorities.includes(priority)) {
    throw new Error(`Unsupported project priority: ${priority}`);
  }

  const createdAtIso = assertIsoTimestamp('projectRequest.createdAtIso', input.createdAtIso);

  return Object.freeze({
    id: input.id,
    clientId: input.clientId,
    title: input.title.trim(),
    brief: input.brief.trim(),
    budgetRange: optionalTrim(input.budgetRange),
    deadlineIso: optionalIsoTimestamp('projectRequest.deadlineIso', input.deadlineIso),
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
    throw new Error(`Illegal project request transition: ${request.status} -> ${nextStatus}`);
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

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty.`);
  }
}

function assertIsoTimestamp(name: string, value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be an ISO timestamp.`);
  }
  return value;
}

function optionalIsoTimestamp(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return assertIsoTimestamp(name, value);
}

function optionalTrim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
