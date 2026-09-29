// EXEC-FOUND-047: Content-Type Negotiation
import { HttpError } from './errors/classify.ts';

export type MediaType = 'application/json' | 'text/plain';

export function negotiateContentType(
  acceptHeader: string | undefined,
  supported: readonly MediaType[] = ['application/json', 'text/plain']
): MediaType {
  if (!acceptHeader || acceptHeader.trim() === '' || acceptHeader.includes('*/*')) {
    return supported[0] ?? 'application/json';
  }

  const Preferences = acceptHeader
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase())
    .filter(Boolean);

  for (const pref of Preferences) {
    if (pref === '*/*') {
      return supported[0];
    }
    const match = supported.find((s) => s.toLowerCase() === pref);
    if (match) {
      return match;
    }
    if (pref === 'application/*' && supported.includes('application/json')) {
      return 'application/json';
    }
    if (pref === 'text/*' && supported.includes('text/plain')) {
      return 'text/plain';
    }
  }

  throw new HttpError(
    406,
    'NOT_ACCEPTABLE',
    `None of the requested Accept media types are supported. Supported: ${supported.join(', ')}`
  );
}
