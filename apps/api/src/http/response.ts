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

export function serializeResponse(
  value: unknown,
  context: ResponseSerializationContext = {}
): SerializedResponse {
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
