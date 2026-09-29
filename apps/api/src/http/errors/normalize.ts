// EXEC-FOUND-049: Error Response Normalization
import type { ErrorResponse } from '../../../../../packages/http-contracts/src/error-response.ts';
import { classifyHttpError } from './classify.ts';

export function normalizeError(error: unknown, correlationId?: string): ErrorResponse {
  const classified = classifyHttpError(error);

  if (classified.kind === 'client') {
    return Object.freeze({
      code: classified.code,
      message: classified.message,
      status: classified.status,
      ...(correlationId ? { correlationId } : {}),
      ...(classified.details ? { details: classified.details } : {}),
    });
  }

  // Server errors never leak stack traces, SQL queries, or internal error messages
  return Object.freeze({
    code: classified.code,
    message: classified.message,
    status: classified.status,
    ...(correlationId ? { correlationId } : {}),
  });
}
