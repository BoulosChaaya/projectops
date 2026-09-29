// EXEC-FOUND-040: Body Parsing
import type { Readable } from 'node:stream';
import { rejectMalformedRequest } from './malformed-request.ts';

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB

export async function parseBody(
  stream: Readable | AsyncIterable<Buffer | string> | Buffer | string | null | undefined,
  contentType: string | undefined,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<unknown> {
  if (stream === null || stream === undefined) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  if (typeof stream === 'string' || Buffer.isBuffer(stream)) {
    const buf = Buffer.isBuffer(stream) ? stream : Buffer.from(stream, 'utf8');
    if (buf.byteLength > maxBytes) {
      throw rejectMalformedRequest('payload_too_large', { maxBytes });
    }
    chunks.push(buf);
    totalBytes = buf.byteLength;
  } else {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      totalBytes += buf.byteLength;
      if (totalBytes > maxBytes) {
        throw rejectMalformedRequest('payload_too_large', { maxBytes });
      }
      chunks.push(buf);
    }
  }

  if (totalBytes === 0) {
    return undefined;
  }

  const rawText = Buffer.concat(chunks).toString('utf8');
  const normalizedMime = (contentType ?? 'application/json').split(';')[0].trim().toLowerCase();

  if (normalizedMime === 'application/json') {
    try {
      return JSON.parse(rawText);
    } catch {
      throw rejectMalformedRequest('malformed_json');
    }
  }

  if (normalizedMime === 'text/plain') {
    return rawText;
  }

  throw rejectMalformedRequest('unsupported_media_type', { contentType: normalizedMime });
}
