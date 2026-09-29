// EXEC-FOUND-032: Bind Failure Handling
export interface BindFailure {
  readonly kind: 'address_in_use' | 'permission_denied' | 'invalid_address' | 'unknown_bind_error';
  readonly code?: string;
  readonly message: string;
}

export function classifyBindFailure(error: unknown): BindFailure {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);

  if (code === 'EADDRINUSE') {
    return Object.freeze({ kind: 'address_in_use', code, message });
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return Object.freeze({ kind: 'permission_denied', code, message });
  }
  if (code === 'EADDRNOTAVAIL' || code === 'EINVAL') {
    return Object.freeze({ kind: 'invalid_address', code, message });
  }
  return Object.freeze({
    kind: 'unknown_bind_error',
    ...(code ? { code } : {}),
    message,
  });
}
