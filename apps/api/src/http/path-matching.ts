// EXEC-FOUND-043: Path Matching
export interface RouteDefinition<THandler = unknown> {
  readonly method: string | readonly string[];
  readonly path: string;
  readonly handler: THandler;
}

export interface RouteMatch<THandler = unknown> {
  readonly route: RouteDefinition<THandler>;
  readonly params: Readonly<Record<string, string>>;
}

function splitSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function matchPath<THandler = unknown>(
  requestPath: string,
  routes: readonly RouteDefinition<THandler>[]
): RouteMatch<THandler> | null {
  const reqSegs = splitSegments(requestPath);

  // Sort candidates so static segments always take precedence over parameterized (:param) segments
  const sortedRoutes = [...routes].sort((a, b) => {
    const aDynamic = splitSegments(a.path).filter((s) => s.startsWith(':')).length;
    const bDynamic = splitSegments(b.path).filter((s) => s.startsWith(':')).length;
    return aDynamic - bDynamic;
  });

  for (const route of sortedRoutes) {
    const routeSegs = splitSegments(route.path);
    if (routeSegs.length !== reqSegs.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < routeSegs.length; i += 1) {
      const rSeg = routeSegs[i];
      const qSeg = reqSegs[i];
      if (rSeg.startsWith(':') && rSeg.length > 1) {
        params[rSeg.slice(1)] = decodeURIComponent(qSeg);
      } else if (rSeg !== qSeg) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return Object.freeze({
        route,
        params: Object.freeze(params),
      });
    }
  }

  return null;
}
