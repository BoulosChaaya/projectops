// EXEC-FOUND-051: Consistent Error Shape Design
import type { ValidationProblem } from './validation-problem.ts';

export interface ErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly correlationId?: string;
  readonly details?: Readonly<{
    readonly problems?: readonly ValidationProblem[];
    readonly [key: string]: unknown;
  }>;
}

export function isValidErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0 &&
    typeof candidate.status === 'number' &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status <= 599
  );
}
