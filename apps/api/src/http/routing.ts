// EXEC-FOUND-042: Request Routing
import { matchPath, type RouteDefinition, type RouteMatch } from './path-matching.ts';
import { matchMethod } from './method-matching.ts';
import { routeNotFound } from './not-found.ts';

export function routeRequest<THandler = unknown>(
  request: { method: string; path: string },
  routes: readonly RouteDefinition<THandler>[]
): RouteMatch<THandler> {
  const methodMatchedRoutes = routes.filter((r) => matchMethod(request.method, r));
  const fullMatch = matchPath(request.path, methodMatchedRoutes);
  if (fullMatch) {
    return fullMatch;
  }

  // Check if path exists under a different HTTP method (405 vs 404)
  const pathOnlyMatch = matchPath(request.path, routes);
  if (pathOnlyMatch) {
    throw routeNotFound(request, true);
  }

  throw routeNotFound(request, false);
}
