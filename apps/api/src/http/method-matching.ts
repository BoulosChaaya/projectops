// EXEC-FOUND-044: Method Matching
export interface RouteMethodSpec {
  readonly method: string | readonly string[];
}

export function matchMethod(requestMethod: string, route: RouteMethodSpec): boolean {
  const normalizedReq = requestMethod.trim().toUpperCase();
  if (Array.isArray(route.method)) {
    return route.method.some((m) => String(m).trim().toUpperCase() === normalizedReq);
  }
  return String(route.method).trim().toUpperCase() === normalizedReq;
}
