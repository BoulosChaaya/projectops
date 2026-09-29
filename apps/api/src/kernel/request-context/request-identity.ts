// EXEC-FOUND-057: Request/Correlation Identity
import crypto from 'node:crypto';
import { HttpError } from '../../http/errors/classify.ts';

const SAFE_CORRELATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;

export interface RequestIdentity {
  readonly requestId: string;
  readonly correlationId: string;
}

export function resolveRequestIdentity(incomingCorrelationHeader?: string): RequestIdentity {
  const requestId = `req_${crypto.randomUUID()}`;
  if (incomingCorrelationHeader === undefined || incomingCorrelationHeader.trim() === '') {
    return Object.freeze({
      requestId,
      correlationId: requestId,
    });
  }

  const trimmed = incomingCorrelationHeader.trim();
  if (!SAFE_CORRELATION_ID_PATTERN.test(trimmed)) {
    throw new HttpError(
      400,
      'INVALID_CORRELATION_ID',
      'Header x-correlation-id is invalid or exceeds 64 safe characters.'
    );
  }

  return Object.freeze({
    requestId,
    correlationId: trimmed,
  });
}

export const requestCorrelationIdentity = resolveRequestIdentity;
