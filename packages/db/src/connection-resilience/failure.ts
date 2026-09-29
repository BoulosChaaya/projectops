// EXEC-DB-004: Connection Failure Handling
export type ConnectionFailureCategory =
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'server_unavailable'
  | 'protocol'
  | 'unknown';

export interface ConnectionFailure {
  readonly category: ConnectionFailureCategory;
  readonly transient: boolean;
  readonly code?: string;
  readonly message: string;
  readonly cause: unknown;
}

export function classifyConnectionFailure(error: unknown): ConnectionFailure {
  const code = (error as { code?: string })?.code;
  const name = (error as { name?: string })?.name;
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'DatabaseConnectTimeoutError' || code === 'ETIMEDOUT' || code === '57014') {
    return Object.freeze({
      category: 'timeout',
      transient: true,
      code: code ?? 'ETIMEDOUT',
      message: 'Database connection or query timed out.',
      cause: error,
    });
  }

  if (code === '28P01' || code === '28000') {
    return Object.freeze({
      category: 'authentication',
      transient: false,
      code,
      message: 'Database authentication failed.',
      cause: error,
    });
  }

  if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH', '08001', '08006'].includes(code ?? '')) {
    return Object.freeze({
      category: 'network',
      transient: code !== 'ENOTFOUND',
      code,
      message: 'Database network connectivity failure.',
      cause: error,
    });
  }

  if (['57P03', '53300', '08004'].includes(code ?? '')) {
    return Object.freeze({
      category: 'server_unavailable',
      transient: code !== '08004',
      code,
      message: 'Database server is temporarily unavailable or rejecting connections.',
      cause: error,
    });
  }

  if (code === '08P01') {
    return Object.freeze({
      category: 'protocol',
      transient: false,
      code,
      message: 'Database wire protocol handshake violation.',
      cause: error,
    });
  }

  return Object.freeze({
    category: 'unknown',
    transient: false,
    ...(code ? { code } : {}),
    message: 'Unclassified database connection failure.',
    cause: error,
  });
}
