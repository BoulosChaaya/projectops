// EXEC-FOUND-041: Malformed Request Rejection
import { HttpError } from './errors/classify.ts';

export type MalformedReason =
  | 'malformed_json'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'invalid_header'
  | 'invalid_request_line'
  | 'request_timeout';

const REASON_MAP: Readonly<Record<MalformedReason, { status: number; code: string; message: string }>> =
  Object.freeze({
    malformed_json: {
      status: 400,
      code: 'MALFORMED_JSON_BODY',
      message: 'Request body contains malformed JSON.',
    },
    payload_too_large: {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds maximum permitted byte size.',
    },
    unsupported_media_type: {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Request Content-Type is not supported.',
    },
    invalid_header: {
      status: 400,
      code: 'MALFORMED_HEADERS',
      message: 'Request headers are malformed or exceed limits.',
    },
    invalid_request_line: {
      status: 400,
      code: 'MALFORMED_REQUEST_URI',
      message: 'Request URI or method is malformed.',
    },
    request_timeout: {
      status: 408,
      code: 'REQUEST_TIMEOUT',
      message: 'Request exceeded configured timeout deadline.',
    },
  });

export function rejectMalformedRequest(
  reason: MalformedReason,
  safeDetails?: Record<string, unknown>
): HttpError {
  const spec = REASON_MAP[reason] ?? REASON_MAP.invalid_request_line;
  return new HttpError(spec.status, spec.code, spec.message, safeDetails);
}
