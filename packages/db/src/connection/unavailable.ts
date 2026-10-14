// Recognizes errors that mean "the database cannot be reached right now", as opposed to errors in
// a particular query. The HTTP layer answers these with 503 so clients and monitors can tell a
// temporary outage from a bug. Shapes were recorded from pg 8 against PostgreSQL 16:
//   server down before connecting   Error code ECONNREFUSED (or AggregateError of them)
//   server stopped mid-session      DatabaseError code 57P01 (admin shutdown)
//   socket dropped                  Error "Connection terminated unexpectedly"
//   pool exhausted / slow connect   Error "timeout exceeded when trying to connect"
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
]);
// SQLSTATE: class 08 connection exceptions; 57P01-57P03 shutdown and startup; 53300 too many connections.
const SQLSTATE = /^(08...|57P0[123]|53300)$/;
const MESSAGES = [
  /^timeout exceeded when trying to connect$/i,
  /^Connection terminated/i,
  /^Client has encountered a connection error and is not queryable$/i,
];
const MAX_DEPTH = 5;

export function isDatabaseUnavailableError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > MAX_DEPTH) return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  if (typeof candidate.code === 'string' && (NETWORK_CODES.has(candidate.code) || SQLSTATE.test(candidate.code))) return true;
  if (typeof candidate.message === 'string' && MESSAGES.some(pattern => pattern.test(candidate.message as string))) return true;
  // Node reports a refused dual-stack connect (localhost on IPv4 and IPv6) as an AggregateError.
  if (Array.isArray(candidate.errors) && candidate.errors.some(inner => isDatabaseUnavailableError(inner, depth + 1))) return true;
  return isDatabaseUnavailableError(candidate.cause, depth + 1);
}
