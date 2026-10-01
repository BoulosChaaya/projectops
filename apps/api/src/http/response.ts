// EXEC-FOUND-046: Response Serialization
import { negotiateContentType, type MediaType } from './content-negotiation.ts';
import { encodePayload } from './payload.ts';

export interface ResponseSerializationContext {
  readonly status?: number;
  readonly accept?: string;
  readonly supportedMediaTypes?: readonly MediaType[];
  readonly headers?: Record<string, string>;
  readonly correlationId?: string;
}

export interface SerializedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export interface DirectHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Buffer;
}

export function serializeResponse(
  value: unknown,
  context: ResponseSerializationContext = {}
): SerializedResponse {
  if (isDirectHttpResponse(value)) {
    const body = typeof value.body === 'string' ? Buffer.from(value.body, 'utf8') : value.body;
    const headers: Record<string, string> = {
      ...value.headers,
      'content-length': value.headers['content-length'] ?? String(body.byteLength),
    };
    if (context.correlationId && !headers['x-correlation-id']) {
      headers['x-correlation-id'] = context.correlationId;
    }

    return Object.freeze({
      status: value.status,
      headers: Object.freeze(headers),
      body,
    });
  }

  const isNoContent = value === undefined || context.status === 204;
  const status = context.status ?? (isNoContent ? 204 : 200);
  const mediaType = negotiateContentType(context.accept, context.supportedMediaTypes);
  const encoded = isNoContent
    ? { body: Buffer.alloc(0), contentType: `${mediaType}; charset=utf-8`, contentLength: 0 }
    : encodePayload(value, mediaType);

  const headers: Record<string, string> = {
    ...(context.headers ?? {}),
    'content-length': String(encoded.contentLength),
  };

  if (!isNoContent) {
    headers['content-type'] = encoded.contentType;
  }
  if (context.correlationId) {
    headers['x-correlation-id'] = context.correlationId;
  }

  return Object.freeze({
    status,
    headers: Object.freeze(headers),
    body: encoded.body,
  });
}

function isDirectHttpResponse(value: unknown): value is DirectHttpResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DirectHttpResponse>;
  return (
    typeof candidate.status === 'number' &&
    Boolean(candidate.headers) &&
    typeof candidate.headers === 'object' &&
    (typeof candidate.body === 'string' || Buffer.isBuffer(candidate.body))
  );
}
