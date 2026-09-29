// EXEC-FOUND-016: Unrecoverable Error Detection
const UNRECOVERABLE_CODES = new Set([
  'ERR_OUT_OF_MEMORY',
  'FATAL_INVARIANT_VIOLATION',
  'CONFIG_REQUIRED_MISSING',
  'CONFIG_PARSE_INVALID',
  'EADDRINUSE',
  'EACCES',
]);

export function isUnrecoverable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { fatal?: boolean; unrecoverable?: boolean; code?: string; name?: string };
  if (maybe.fatal === true || maybe.unrecoverable === true) {
    return true;
  }
  if (typeof maybe.code === 'string' && UNRECOVERABLE_CODES.has(maybe.code)) {
    return true;
  }
  if (maybe.name === 'SyntaxError' || maybe.name === 'ReferenceError') {
    return true;
  }
  return false;
}
