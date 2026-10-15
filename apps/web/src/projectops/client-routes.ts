import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';
import { renderProjectPage } from './project-page.ts';

/**
 * Page routes. The client directory and client pages are rendered by the React client (`page`);
 * the project workspace is still server-rendered until it moves too.
 */
export function createClientWebRoutes(page: () => Promise<DirectHttpResponse>): RouteDefinition<KernelRouteHandler>[] {
  return [
    { method: 'GET', path: '/projectops/client-management', handler: () => page() },
    { method: 'GET', path: '/projectops/client-management/:id', handler: () => page() },
    { method: 'GET', path: '/projectops/projects/:id', handler: () => renderProjectPage() },
  ];
}
