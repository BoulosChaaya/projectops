import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';
import type { ProjectOpsApiService } from '../../../api/src/projectops/routes.ts';
import { composeProjectOpsDashboardPageFromSummary } from './dashboard-view.ts';
import { renderProjectOpsDashboardPage } from './dashboard-renderer.ts';

export function createProjectOpsDashboardWebRoute(
  service: Pick<ProjectOpsApiService, 'getDashboard'>
): RouteDefinition<KernelRouteHandler> {
  return Object.freeze({
    method: 'GET',
    path: '/projectops',
    handler: async () => {
      const summary = await service.getDashboard();
      const rendered = renderProjectOpsDashboardPage(
        composeProjectOpsDashboardPageFromSummary(summary)
      );

      return Object.freeze({
        status: rendered.status,
        headers: rendered.headers,
        body: rendered.html,
      } satisfies DirectHttpResponse);
    },
  });
}
