// EXEC-FOUND-048: Payload Encoding
import type { MediaType } from './content-negotiation.ts';
import { HttpError } from './errors/classify.ts';

export interface EncodedPayload {
  readonly body: Buffer;
  readonly contentType: string;
  readonly contentLength: number;
}

export function encodePayload(value: unknown, mediaType: MediaType = 'application/json'): EncodedPayload {
  if (value === undefined || value === null) {
    const empty = Buffer.alloc(0);
    return Object.freeze({
      body: empty,
      contentType: `${mediaType}; charset=utf-8`,
      contentLength: 0,
    });
  }

  if (mediaType === 'application/json') {
    try {
      const jsonText = JSON.stringify(value);
      const buf = Buffer.from(jsonText, 'utf8');
      return Object.freeze({
        body: buf,
        contentType: 'application/json; charset=utf-8',
        contentLength: buf.byteLength,
      });
    } catch (err) {
      throw new HttpError(500, 'RESPONSE_ENCODING_FAILED', 'Failed to encode JSON response', undefined, err);
    }
  }

  if (mediaType === 'text/plain') {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const buf = Buffer.from(text, 'utf8');
    return Object.freeze({
      body: buf,
      contentType: 'text/plain; charset=utf-8',
      contentLength: buf.byteLength,
    });
  }

  throw new HttpError(500, 'UNSUPPORTED_RESPONSE_ENCODING', `Unsupported mediaType: ${String(mediaType)}`);
}
