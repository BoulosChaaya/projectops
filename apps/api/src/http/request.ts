// EXEC-FOUND-038: Request Parsing
import type { IncomingMessage } from 'node:http';
import { parseHeaders, type Headers } from './headers.ts';
import { parseBody } from './body.ts';
import { rejectMalformedRequest } from './malformed-request.ts';

export interface ParsedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface RawRequestInput {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined> | readonly string[];
  body?: IncomingMessage | Buffer | string | null;
  maxBodyBytes?: number;
}

export async function parseRequest(raw: IncomingMessage | RawRequestInput): Promise<ParsedRequest> {
  const method = typeof raw.method === 'string' ? raw.method.trim().toUpperCase() : '';
  const rawUrl = typeof raw.url === 'string' ? raw.url.trim() : '';

  if (!method || !rawUrl || !rawUrl.startsWith('/')) {
    throw rejectMalformedRequest('invalid_request_line');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl, 'http://localhost');
  } catch {
    throw rejectMalformedRequest('invalid_request_line');
  }

  const headers = parseHeaders(raw.headers ?? {});
  const query: Record<string, string> = {};
  for (const [k, v] of parsedUrl.searchParams.entries()) {
    query[k] = v;
  }

  const methodsWithBody = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const bodySource = 'body' in raw ? raw.body : (raw as IncomingMessage);
  const maxBytes = 'maxBodyBytes' in raw && typeof raw.maxBodyBytes === 'number' ? raw.maxBodyBytes : undefined;

  const body = methodsWithBody.has(method)
    ? await parseBody(bodySource, headers.get('content-type'), maxBytes)
    : undefined;

  return Object.freeze({
    method,
    path: parsedUrl.pathname,
    query: Object.freeze(query),
    headers,
    body,
  });
}
