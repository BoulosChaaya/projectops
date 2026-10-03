import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import { renderClientPage } from './client-pages.ts';
import { renderProjectPage } from './project-page.ts';

export function createClientWebRoutes(): RouteDefinition<KernelRouteHandler>[] {
  return [
    { method: 'GET', path: '/projectops/client-management', handler: () => renderClientPage('directory') },
    { method: 'GET', path: '/projectops/client-management/:id', handler: () => renderClientPage('detail') },
    { method: 'GET', path: '/projectops/projects/:id', handler: () => renderProjectPage() },
  ];
}
