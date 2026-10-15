import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';

/**
 * Page routes rendered by the React client (`page`): the client directory, client pages and the
 * project workspace. The delivery summary stays server-rendered (project-handoff-routes.ts).
 */
export function createClientWebRoutes(page: () => Promise<DirectHttpResponse>): RouteDefinition<KernelRouteHandler>[] {
  return [
    { method: 'GET', path: '/projectops/client-management', handler: () => page() },
    { method: 'GET', path: '/projectops/client-management/:id', handler: () => page() },
    { method: 'GET', path: '/projectops/projects/:id', handler: () => page() },
  ];
}
