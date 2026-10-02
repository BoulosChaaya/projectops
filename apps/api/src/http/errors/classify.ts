// EXEC-FOUND-050: Error Classification (client vs server)
import type { ValidationProblem } from '../../../../../packages/http-contracts/src/validation-problem.ts';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly safeDetails?: Readonly<Record<string, unknown>>;

  constructor(
    status: number,
    code: string,
    message: string,
    safeDetails?: Record<string, unknown>,
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (safeDetails) {
      this.safeDetails = Object.freeze({ ...safeDetails });
    }
  }
}

export interface ClientError {
  readonly kind: 'client';
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ServerError {
  readonly kind: 'server';
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export function classifyHttpError(error: unknown): ClientError | ServerError {
  if (isHttpError(error)) {
    if (error.status >= 400 && error.status < 500) {
      return Object.freeze({
        kind: 'client',
        status: error.status,
        code: error.code,
        message: error.message,
        ...(error.safeDetails ? { details: error.safeDetails } : {}),
      });
    }
    return Object.freeze({
      kind: 'server',
      status: error.status >= 500 && error.status <= 599 ? error.status : 500,
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred.',
    });
  }

  const maybeProblems = (error as { problems?: ValidationProblem[] })?.problems;
  if (Array.isArray(maybeProblems)) {
    return Object.freeze({
      kind: 'client',
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Request input validation failed.',
      details: Object.freeze({ problems: Object.freeze([...maybeProblems]) }),
    });
  }

  return Object.freeze({
    kind: 'server',
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected internal server error occurred.',
  });
}

function isHttpError(error: unknown): error is HttpError {
  return (
    error instanceof HttpError ||
    (
      Boolean(error) &&
      typeof error === 'object' &&
      (error as { name?: unknown }).name === 'HttpError' &&
      typeof (error as { status?: unknown }).status === 'number' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { message?: unknown }).message === 'string'
    )
  );
}
