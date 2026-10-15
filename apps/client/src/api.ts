// Typed client for the ProjectOps JSON API. Same origin: the browser sends the HttpOnly session
// cookie and the Origin header itself; writes add the session's CSRF token.

import type { DashboardFilter, ProjectOpsDashboardView } from '../../../packages/projectops/src/dashboard.ts';
import type { ClientStatus, ProjectOpsClient, ProjectPriority, ProjectRequest } from '../../../packages/projectops/src/domain.ts';
import type { Page } from '../../../packages/projectops/src/page.ts';

// Response types come from the domain package itself, so the client and the server cannot drift.
export type { ProjectOpsDashboardView } from '../../../packages/projectops/src/dashboard.ts';
export type { ProjectOpsClient, ProjectRequest } from '../../../packages/projectops/src/domain.ts';
export type { Page } from '../../../packages/projectops/src/page.ts';

export type ClientListStatus = ClientStatus | 'all';
/** Optional text fields are sent as undefined when blank: the server stores no value, never an empty string. */
export interface ClientInput { readonly name: string; readonly contactName?: string; readonly email?: string }
export interface ProjectInput {
  readonly title: string; readonly brief: string; readonly budgetRange?: string;
  readonly priority: ProjectPriority; readonly deadlineIso?: string;
}

export type Priority = 'low' | 'medium' | 'high';

/** Mirrors validateOperatorDefaults in packages/projectops/src/operator.ts. */
export interface OperatorDefaults {
  readonly defaultCurrency: string;
  readonly defaultPriority: Priority;
  readonly timezone: string;
}

/** GET /projectops/access/session */
export interface Session {
  readonly login: string;
  readonly csrfToken: string;
  readonly defaults: OperatorDefaults;
}

/** A failed request: `message` is the server's own explanation, safe to show to the operator. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const FALLBACK: Record<number, string> = {
  429: 'Too many attempts. Try again in one minute.',
  503: 'ProjectOps is temporarily unavailable. Try again shortly.',
};

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, options: { body?: unknown; csrf?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['content-type'] = 'application/json';
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  } catch {
    throw new ApiError(0, 'Could not reach ProjectOps. Check your connection and try again.');
  }
  const data = await response.json().catch(() => undefined) as { message?: unknown; code?: unknown } | undefined;
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : FALLBACK[response.status] ?? `Request failed (${response.status}).`;
    throw new ApiError(response.status, message, typeof data?.code === 'string' ? data.code : undefined);
  }
  return data as T;
}

export const api = {
  /** The signed-in operator, or null when there is no valid session. */
  async session(): Promise<Session | null> {
    try { return await request<Session>('GET', '/projectops/access/session'); }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
  },
  login: (login: string, password: string) =>
    request<{ csrfToken: string }>('POST', '/projectops/access/login', { body: { login, password } }),
  saveDefaults: (csrf: string, defaults: OperatorDefaults) =>
    request<OperatorDefaults>('POST', '/projectops/access/settings', { body: defaults, csrf }),
  changeCredentials: (csrf: string, body: { newLogin: string; currentPassword: string; newPassword: string }) =>
    request<{ signedOut: true }>('POST', '/projectops/access/credentials', { body, csrf }),
  logout: (csrf: string) => request<{ signedOut: true }>('POST', '/projectops/access/logout', { body: {}, csrf }),
  clients: (filter: { q: string; status: ClientListStatus; cursor?: string }) =>
    request<Page<ProjectOpsClient>>('GET', `/projectops/clients?${new URLSearchParams({ q: filter.q, status: filter.status, ...(filter.cursor ? { cursor: filter.cursor } : {}) })}`),
  client: (id: string) => request<ProjectOpsClient>('GET', `/projectops/clients/${encodeURIComponent(id)}`),
  clientProjects: (id: string) => request<ProjectRequest[]>('GET', `/projectops/clients/${encodeURIComponent(id)}/projects`),
  createClient: (csrf: string, id: string, input: ClientInput) =>
    request<ProjectOpsClient>('POST', '/projectops/clients', { body: { id, ...input }, csrf }),
  /** Optimistic concurrency: the edit applies only if the client is still at `expectedRevision` (else 409). */
  editClient: (csrf: string, id: string, input: ClientInput, expectedRevision: number) =>
    request<ProjectOpsClient>('PUT', `/projectops/clients/${encodeURIComponent(id)}`, { body: { ...input, expectedRevision }, csrf }),
  archiveClient: (csrf: string, id: string, expectedRevision: number) =>
    request<ProjectOpsClient>('POST', `/projectops/clients/${encodeURIComponent(id)}/archive`, { body: { expectedRevision }, csrf }),
  createProject: (csrf: string, id: string, clientId: string, input: ProjectInput) =>
    request<ProjectRequest>('POST', '/projectops/project-requests', { body: { id, clientId, ...input }, csrf }),
  project: (id: string) => request<ProjectRequest>('GET', `/projectops/project-requests/${encodeURIComponent(id)}`),
  /** One of a project's record collections (tasks, notes, invoices, history and so on). */
  projectCollection: <T,>(id: string, path: string) => request<T[]>('GET', `/projectops/project-requests/${encodeURIComponent(id)}/${path}`),
  /** A write under /project-requests/:id ('' for the project itself, else a sub-path such as 'tasks' or 'control'). */
  projectWrite: <T,>(csrf: string, method: 'POST' | 'PUT', id: string, path: string, body: unknown) =>
    request<T>(method, `/projectops/project-requests/${encodeURIComponent(id)}${path ? `/${path}` : ''}`, { body, csrf }),
  /** The operational summary for active projects matching the filter, evaluated by the server's clock. */
  dashboard: (filter: DashboardFilter) =>
    request<ProjectOpsDashboardView>('GET', `/projectops/dashboard?${new URLSearchParams({ q: filter.q ?? '', status: filter.status ?? 'all' })}`),
};
