import type { RouteDefinition } from '../http/path-matching.ts';
import type { KernelRouteHandler } from '../bootstrap/http-listener.ts';
import { HttpError } from '../http/errors/classify.ts';
import { ProjectOpsValidationError } from '../../../../packages/projectops/src/index.ts';
import type {
  NewClientInput,
  NewProjectRequestInput,
  ProjectOpsClient,
  ProjectOpsDashboardView,
  ProjectRequest,
  ProjectRequestStatus,
} from '../../../../packages/projectops/src/index.ts';

export interface ProjectOpsApiService {
  createClient(input: NewClientInput): Promise<ProjectOpsClient>;
  createProjectRequest(input: NewProjectRequestInput): Promise<ProjectRequest>;
  transitionProjectRequest(
    id: string,
    nextStatus: ProjectRequestStatus,
    nowIso: string
  ): Promise<ProjectRequest>;
  getDashboard(): Promise<ProjectOpsDashboardView>;
}

export function createProjectOpsRoutes(
  service: ProjectOpsApiService,
  clock: () => string = () => new Date().toISOString()
): readonly RouteDefinition<KernelRouteHandler>[] {
  return Object.freeze([
    {
      method: 'POST',
      path: '/projectops/clients',
      handler: async (request) =>
        await runProjectOpsRequest(() => service.createClient(readClientInput(request.body, clock))),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests',
      handler: async (request) =>
        await runProjectOpsRequest(() =>
          service.createProjectRequest(readProjectRequestInput(request.body, clock))
        ),
    },
    {
      method: 'POST',
      path: '/projectops/project-requests/:id/status',
      handler: async (request, _context, params) => {
        const body = readRecord(request.body);
        const nextStatus = readStatus(body.status);
        return await runProjectOpsRequest(() =>
          service.transitionProjectRequest(params.id, nextStatus, clock())
        );
      },
    },
    {
      method: 'GET',
      path: '/projectops/dashboard',
      handler: async () => await service.getDashboard(),
    },
  ]);
}

async function runProjectOpsRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isProjectOpsValidationError(error)) {
      throw new HttpError(400, error.code, error.message);
    }
    throw error;
  }
}

function isProjectOpsValidationError(
  error: unknown
): error is ProjectOpsValidationError {
  return (
    error instanceof ProjectOpsValidationError ||
    (
      Boolean(error) &&
      typeof error === 'object' &&
      (error as { name?: unknown }).name === 'ProjectOpsValidationError' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { message?: unknown }).message === 'string'
    )
  );
}

function readClientInput(body: unknown, clock: () => string): NewClientInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    name: readString(value.name, 'name'),
    contactName: readOptionalString(value.contactName, 'contactName'),
    email: readOptionalString(value.email, 'email'),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readProjectRequestInput(body: unknown, clock: () => string): NewProjectRequestInput {
  const value = readRecord(body);
  return Object.freeze({
    id: readString(value.id, 'id'),
    clientId: readString(value.clientId, 'clientId'),
    title: readString(value.title, 'title'),
    brief: readString(value.brief, 'brief'),
    budgetRange: readOptionalString(value.budgetRange, 'budgetRange'),
    deadlineIso: readOptionalString(value.deadlineIso, 'deadlineIso'),
    priority: readOptionalPriority(value.priority),
    createdAtIso: readOptionalString(value.createdAtIso, 'createdAtIso') ?? clock(),
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_PROJECTOPS_PAYLOAD', 'Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'INVALID_PROJECTOPS_FIELD', `Missing or invalid field: ${field}.`);
  }
  return value;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_PROJECTOPS_FIELD', `Invalid field: ${field}.`);
  }
  return value;
}

function readOptionalPriority(value: unknown): 'low' | 'medium' | 'high' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new HttpError(400, 'INVALID_PROJECTOPS_PRIORITY', 'Unsupported project priority.');
}

function readStatus(value: unknown): ProjectRequestStatus {
  if (
    value === 'new' ||
    value === 'estimated' ||
    value === 'approved' ||
    value === 'in_progress' ||
    value === 'delivered' ||
    value === 'archived'
  ) {
    return value;
  }
  throw new HttpError(400, 'INVALID_PROJECTOPS_STATUS', 'Unsupported project request status.');
}
