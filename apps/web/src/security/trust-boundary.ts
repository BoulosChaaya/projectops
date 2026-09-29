// EXEC-CLIENT-001..005: Server/Browser Trust Boundary, Client Env & Redirect Guard
export function extractClientSafeEnv(
  fullEnv: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string>> {
  const clientEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(fullEnv)) {
    if (key.startsWith('NEXT_PUBLIC_') && typeof val === 'string') {
      if (/(?:SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL)/i.test(key)) {
        throw new Error(`Security violation: secret key ${key} cannot use NEXT_PUBLIC_ prefix.`);
      }
      clientEnv[key] = val;
    }
  }
  return Object.freeze(clientEnv);
}

export function stripServerOnlyFields<T extends Record<string, unknown>>(
  entity: T,
  allowedClientFields: readonly (keyof T & string)[]
): Readonly<Partial<T>> {
  const safe: Record<string, unknown> = {};
  for (const field of allowedClientFields) {
    if (Object.prototype.hasOwnProperty.call(entity, field)) {
      safe[field] = entity[field];
    }
  }
  return Object.freeze(safe) as Readonly<Partial<T>>;
}

export function sanitizeRedirectTarget(target: string | undefined, fallback = '/dashboard'): string {
  if (!target || typeof target !== 'string') {
    return fallback;
  }
  const trimmed = target.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /^[a-zA-Z]+:/i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}
