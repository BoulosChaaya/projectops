// Turns a thrown value into a plain, bounded object for a log record. Error objects serialize to
// {} with JSON.stringify, which is how server errors used to reach the log: a status code and
// nothing to diagnose. This keeps what identifies the failure (name, message, code, stack, cause
// chain, and for PostgreSQL the constraint, table and column) and leaves out what can carry user
// data: pg's `detail` and `where` (they quote row values) and query parameters.
const MAX_CAUSES = 3;
const MAX_STACK_LINES = 12;
const MAX_MESSAGE = 500;
const PG_FIELDS = ['severity', 'schema', 'table', 'column', 'constraint', 'routine'] as const;

export interface ErrorDescription {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly [field: string]: unknown;
}

export function redactSecrets(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi, '$1[Redacted]@')
    .replace(/(password\s*=\s*)('[^']*'|\S+)/gi, '$1[Redacted]');
}

export function describeError(error: unknown, options: { stack?: boolean } = {}): ErrorDescription {
  return describe(error, options.stack ?? true, 0);
}

function describe(error: unknown, withStack: boolean, depth: number): ErrorDescription {
  if (!error || typeof error !== 'object') {
    return { name: typeof error, message: truncate(redactSecrets(String(error))) };
  }
  const source = error as Record<string, unknown>;
  const name = typeof source.name === 'string' ? source.name : 'Error';
  const description: Record<string, unknown> = {
    name,
    message: truncate(redactSecrets(typeof source.message === 'string' ? source.message : String(error))),
  };
  if (typeof source.code === 'string' || typeof source.code === 'number') description.code = String(source.code);
  for (const field of PG_FIELDS) if (typeof source[field] === 'string') description[field] = source[field];
  if (withStack && typeof source.stack === 'string') {
    // The first stack line repeats the message; keep only frames.
    description.stack = redactSecrets(source.stack.split('\n').slice(1, MAX_STACK_LINES + 1).map(line => line.trim()).join('\n'));
  }
  if (Array.isArray(source.errors) && source.errors.length > 0 && depth < MAX_CAUSES) {
    description.errors = source.errors.slice(0, 3).map(inner => describe(inner, false, depth + 1));
  }
  if (source.cause !== undefined && depth < MAX_CAUSES) description.cause = describe(source.cause, withStack, depth + 1);
  return description as ErrorDescription;
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}
