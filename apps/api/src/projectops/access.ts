import { timingSafeEqual } from 'node:crypto';
import type { ProjectOpsOperatorStore, OperatorSession } from '../../../../packages/projectops/src/operator.ts';
import { validateOperatorDefaults, validateOperatorLogin, validateOperatorPassword } from '../../../../packages/projectops/src/operator.ts';
import type { KernelRouteHandler } from '../bootstrap/http-listener.ts';
import type { ParsedRequest } from '../http/request.ts';
import type { RouteDefinition } from '../http/path-matching.ts';
import { HttpError } from '../http/errors/classify.ts';
import { isDirectHttpResponse, type DirectHttpResponse } from '../http/response.ts';
import { DEMO_TOKEN, type DemoSession, type ProjectOpsDemoSandboxes } from '../../../../packages/projectops/src/demo-sandboxes.ts';

type AccessStore = Pick<ProjectOpsOperatorStore, 'login' | 'resolve' | 'logout' | 'saveDefaults' | 'changeCredentials'>;
type DemoStore = Pick<ProjectOpsDemoSandboxes, 'start' | 'resolve' | 'saveDefaults' | 'reset' | 'end' | 'limits'>;
const isDemo = (session: OperatorSession): session is DemoSession => 'demo' in session;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }, body: JSON.stringify(body) });

export class ProjectOpsAccess {
  private origin: string | undefined;
  private readonly store: AccessStore;
  private readonly demo: DemoStore | undefined;
  /** With `demo`, visitors can start a private demo sandbox; their session resolves to it, never to the operator. */
  constructor(store: AccessStore, publicOrigin?: string, demo?: DemoStore) { this.store = store; this.origin = publicOrigin; this.demo = demo; }
  configureOrigin(origin: string) { this.origin ??= origin; }
  private get cookieName() { return this.origin?.startsWith('https:') ? '__Host-projectops_session' : 'projectops_session'; }
  private cookie(token: string, clear = false, maxAge = 28800) {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : maxAge}${this.origin?.startsWith('https:') ? '; Secure' : ''}`;
  }
  /** A demo token only ever resolves to its sandbox; an operator token only to the operator. */
  private async resolve(request: ParsedRequest): Promise<OperatorSession | null> {
    const token = this.readCookie(request);
    if (token && DEMO_TOKEN.test(token)) return this.demo ? await this.demo.resolve(token) : null;
    return await this.store.resolve(token);
  }
  private readCookie(request: ParsedRequest): string | undefined {
    const matches = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${this.cookieName}=`));
    return matches.length === 1 ? matches[0].slice(this.cookieName.length + 1) : undefined;
  }
  private mutation(request: ParsedRequest, session?: OperatorSession) {
    if (!this.origin || request.headers.get('origin') !== this.origin) throw new HttpError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED', 'Send an application/json request.');
    if (session) {
      const supplied = Buffer.from(request.headers.get('x-csrf-token') ?? '');
      const expected = Buffer.from(session.csrfToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(403, 'CSRF_REJECTED', 'Session verification failed.');
    }
  }
  protect(route: RouteDefinition<KernelRouteHandler>): RouteDefinition<KernelRouteHandler> {
    return { ...route, handler: async (request, context, params) => {
      const session = await this.resolve(request);
      if (!session) {
        if (request.method === 'GET' && (['/projectops', '/projectops/settings'].includes(route.path) || route.path.startsWith('/projectops/client-management') || route.path.startsWith('/projectops/projects/'))) return { status: 302, headers: { location: '/projectops/login', 'cache-control': 'no-store' }, body: '' };
        return json({ message: 'Sign in required.' }, 401);
      }
      context.set('projectops.operator', session);
      // Routes read their data through the sandbox's schema when this is set (app.ts serviceFor).
      if (isDemo(session)) context.set('projectops.sandbox', session.demo.schema);
      if (!['GET', 'HEAD'].includes(request.method)) this.mutation(request, session);
      let prepared = request;
      if (request.method === 'POST' && request.body && typeof request.body === 'object') {
        const body = { ...request.body } as Record<string, unknown>;
        if (route.path === '/projectops/project-requests' && body.priority === undefined) body.priority = session.defaults.defaultPriority;
        if (route.path.endsWith('/estimate') && body.currency === undefined) body.currency = session.defaults.defaultCurrency;
        prepared = { ...request, body };
      }
      const result = await route.handler(prepared, context, params);
      // API data and dashboard pages must never be cached after signing out.
      // Use the serializer's own test for a prepared HTTP response. Checking only for `status` and
      // `body` fields misclassified notes (which have both) and wrote `headers` into their JSON.
      if (isDirectHttpResponse(result)) return { ...result, headers: { ...result.headers, 'cache-control': 'no-store' } };
      return json(result);
    } };
  }
  /** `page` serves the React client's shell for the sign-in and settings pages. */
  routes(page: () => Promise<DirectHttpResponse>): RouteDefinition<KernelRouteHandler>[] {
    const protectedRoute = (method: string, path: string, handler: KernelRouteHandler) => this.protect({ method, path, handler });
    return [
      { method: 'GET', path: '/projectops/login', handler: () => page() },
      { method: 'POST', path: '/projectops/access/login', handler: async request => {
        this.mutation(request);
        const body = request.body as Record<string, unknown> | null;
        if (!body || typeof body.login !== 'string' || body.login.length > 120 || typeof body.password !== 'string' || !body.password || body.password.length > 512) return json({ message: 'Invalid login or password.' }, 401);
        const result = await this.store.login(body.login, body.password);
        if (result === 'limited') return json({ message: 'Too many attempts. Try again in one minute.' }, 429, { 'retry-after': '60' });
        if (!result) return json({ message: 'Invalid login or password.' }, 401);
        return json({ csrfToken: result.csrfToken }, 200, { 'set-cookie': this.cookie(result.rawToken) });
      } },
      protectedRoute('GET', '/projectops/settings', () => page()),
      protectedRoute('GET', '/projectops/access/session', (_request, context) => {
        const s = context.get<OperatorSession>('projectops.operator')!;
        return json({ login: s.login, csrfToken: s.csrfToken, defaults: s.defaults, ...(isDemo(s) ? { demo: { expiresAtIso: s.demo.expiresAtIso } } : {}) });
      }),
      // Whether the sign-in page offers the demo. Public: it says nothing about any session.
      { method: 'GET', path: '/projectops/demo', handler: () => json(this.demo ? { enabled: true, lifetimeMinutes: this.demo.limits.lifetimeMinutes } : { enabled: false }) },
      { method: 'POST', path: '/projectops/demo/start', handler: async request => {
        if (!this.demo) throw new HttpError(404, 'DEMO_DISABLED', 'The demo is not available.');
        this.mutation(request);
        const started = await this.demo.start({ timezone: (request.body as { timezone?: unknown } | null)?.timezone });
        if (started === 'busy') return json({ message: 'The demo is busy right now. Try again in a few minutes.' }, 503, { 'retry-after': '300' });
        // The cookie lives as long as the sandbox does. Taken from the configured lifetime, not by
        // subtracting the app's clock from the database's: the two clocks need not agree, and the
        // database's expiry is checked on every request regardless.
        const maxAge = this.demo.limits.lifetimeMinutes * 60;
        return json({ csrfToken: started.csrfToken, expiresAtIso: started.expiresAtIso }, 200, { 'set-cookie': this.cookie(started.rawToken, false, maxAge) });
      } },
      protectedRoute('POST', '/projectops/demo/reset', async (_request, context) => {
        const s = context.get<OperatorSession>('projectops.operator')!;
        if (!isDemo(s) || !this.demo) throw new HttpError(403, 'DEMO_ONLY', 'Only a demo sandbox can be reset.');
        if (await this.demo.reset(s) === 'busy') return json({ message: 'The demo was just reset. Try again in a moment.' }, 429, { 'retry-after': '30' });
        return json({ reset: true });
      }),
      protectedRoute('POST', '/projectops/access/settings', async (request, context) => {
        let value;
        try { value = validateOperatorDefaults(request.body); }
        catch (error) { throw new HttpError(400, 'INVALID_SETTINGS', (error as Error).message); }
        const s = context.get<OperatorSession>('projectops.operator')!;
        return json(isDemo(s) ? await this.demo!.saveDefaults(s, value) : await this.store.saveDefaults(value));
      }),
      protectedRoute('POST', '/projectops/access/logout', async (_request, context) => {
        const s = context.get<OperatorSession>('projectops.operator')!;
        // Leaving the demo deletes the visitor's sandbox now rather than at expiry.
        if (isDemo(s)) await this.demo!.end(s); else await this.store.logout(s);
        return json({ signedOut: true }, 200, { 'set-cookie': this.cookie('', true) });
      }),
      protectedRoute('POST', '/projectops/access/credentials', async (request, context) => {
        if (isDemo(context.get<OperatorSession>('projectops.operator')!)) throw new HttpError(403, 'DEMO_READ_ONLY_ACCESS', 'Sign-in details cannot be changed in the demo.');
        const b = request.body as Record<string, unknown> | null;
        if (!b || typeof b.currentPassword !== 'string' || !b.currentPassword || b.currentPassword.length > 512) return json({ message: 'Current password is required.' }, 400);
        let login, password;
        try { login = validateOperatorLogin(b.newLogin); password = validateOperatorPassword(b.newPassword); }
        catch (error) { throw new HttpError(400, 'INVALID_CREDENTIALS', (error as Error).message); }
        const result = await this.store.changeCredentials(b.currentPassword, login, password);
        if (result === 'limited') return json({ message: 'Too many attempts. Try again in one minute.' }, 429, { 'retry-after': '60' });
        if (!result) return json({ message: 'Current password is incorrect.' }, 401);
        return json({ signedOut: true }, 200, { 'set-cookie': this.cookie('', true) });
      }),
    ];
  }
}
