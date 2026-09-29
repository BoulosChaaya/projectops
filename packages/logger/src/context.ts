// EXEC-FOUND-013: Log Context Enrichment
const SENSITIVE_KEY = /(?:password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|connection[_-]?string)/i;

export function sanitizeContext(input: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[Redacted]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return Object.freeze(output);
}

export function mergeLogContext(
  parentContext: Readonly<Record<string, unknown>>,
  childContext: Record<string, unknown>
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...parentContext,
    ...sanitizeContext(childContext),
  });
}
