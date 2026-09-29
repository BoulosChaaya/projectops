// EXEC-FOUND-045: Route Not Found Handling
import { HttpError } from './errors/classify.ts';

export function routeNotFound(
  request: { method: string; path: string },
  methodMismatch = false
): HttpError {
  if (methodMismatch) {
    return new HttpError(
      405,
      'METHOD_NOT_ALLOWED',
      `Method ${request.method} is not allowed for path ${request.path}.`
    );
  }
  return new HttpError(404, 'ROUTE_NOT_FOUND', `Route ${request.method} ${request.path} not found.`);
}
