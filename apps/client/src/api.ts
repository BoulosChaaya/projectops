// Typed client for the ProjectOps JSON API. Same origin: the browser sends the HttpOnly session
// cookie and the Origin header itself; writes add the session's CSRF token.

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

async function request<T>(method: 'GET' | 'POST', path: string, options: { body?: unknown; csrf?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method === 'POST') headers['content-type'] = 'application/json';
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
};
