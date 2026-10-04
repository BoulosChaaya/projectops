import { ProjectOpsValidationError, validateDashboardFilter, type DashboardFilter } from '../../../../packages/projectops/src/index.ts';
import type { OperatorSession } from '../../../../packages/projectops/src/operator.ts';
import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';
import type { ProjectOpsApiService } from '../../../api/src/projectops/routes.ts';
import { composeProjectOpsDashboardPageFromSummary } from './dashboard-view.ts';
import { renderProjectOpsDashboardPage, renderDashboardUnavailable } from './dashboard-renderer.ts';

export function createProjectOpsDashboardWebRoute(
  service: Pick<ProjectOpsApiService, 'getDashboard'>, clock: () => string = () => new Date().toISOString()
): RouteDefinition<KernelRouteHandler> {
  return Object.freeze({
    method: 'GET',
    path: '/projectops',
    handler: async (request, context) => {
      let filter: Required<DashboardFilter> = { q: '', status: 'all' };
      try {
        filter = validateDashboardFilter({ q: request.query.q, status: request.query.status as DashboardFilter['status'] });
        const summary = await service.getDashboard(filter, clock());
        const timezone = context.get<OperatorSession>('projectops.operator')?.defaults.timezone ?? 'UTC';
        const rendered = renderProjectOpsDashboardPage(composeProjectOpsDashboardPageFromSummary(summary, timezone));
        return Object.freeze({ status: rendered.status, headers: rendered.headers, body: rendered.html } satisfies DirectHttpResponse);
      } catch (error) {
        return renderDashboardUnavailable(filter, error instanceof ProjectOpsValidationError ? 400 : 500);
      }
    },
  });
}
