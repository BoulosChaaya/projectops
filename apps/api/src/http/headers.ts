// EXEC-FOUND-039: Header Parsing
import { rejectMalformedRequest } from './malformed-request.ts';

export interface Headers {
  get(name: string): string | undefined;
  getAll(name: string): readonly string[];
  entries(): Readonly<Record<string, string>>;
}

export function parseHeaders(
  rawHeaders: Record<string, string | string[] | undefined> | readonly string[]
): Headers {
  const normalizedMulti: Record<string, string[]> = {};

  if (Array.isArray(rawHeaders)) {
    if (rawHeaders.length % 2 !== 0) {
      throw rejectMalformedRequest('invalid_header');
    }
    for (let i = 0; i < rawHeaders.length; i += 2) {
      const rawName = rawHeaders[i];
      const rawVal = rawHeaders[i + 1];
      if (typeof rawName !== 'string' || typeof rawVal !== 'string' || rawName.trim() === '') {
        throw rejectMalformedRequest('invalid_header');
      }
      const key = rawName.trim().toLowerCase();
      if (!normalizedMulti[key]) normalizedMulti[key] = [];
      normalizedMulti[key].push(rawVal.trim());
    }
  } else if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [rawName, rawVal] of Object.entries(rawHeaders)) {
      if (rawVal === undefined) continue;
      const key = rawName.trim().toLowerCase();
      if (!key) {
        throw rejectMalformedRequest('invalid_header');
      }
      if (!normalizedMulti[key]) normalizedMulti[key] = [];
      if (Array.isArray(rawVal)) {
        for (const item of rawVal) {
          normalizedMulti[key].push(String(item).trim());
        }
      } else {
        normalizedMulti[key].push(String(rawVal).trim());
      }
    }
  } else {
    throw rejectMalformedRequest('invalid_header');
  }

  const singleMap: Record<string, string> = {};
  for (const [k, vals] of Object.entries(normalizedMulti)) {
    singleMap[k] = vals.join(', ');
  }
  const frozenSingle = Object.freeze(singleMap);

  return Object.freeze({
    get(name: string): string | undefined {
      return frozenSingle[name.toLowerCase()];
    },
    getAll(name: string): readonly string[] {
      return Object.freeze([...(normalizedMulti[name.toLowerCase()] ?? [])]);
    },
    entries(): Readonly<Record<string, string>> {
      return frozenSingle;
    },
  });
}
