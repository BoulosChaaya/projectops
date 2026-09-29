// EXEC-DB-037: Deadlock Detection & Recovery
export interface DeadlockRecoveryPolicy {
  readonly retrySafe: boolean;
  readonly maxAttempts?: number;
}

export async function executeWithDeadlockRecovery<T>(
  operation: (attempt: number) => Promise<T>,
  policy: DeadlockRecoveryPolicy
): Promise<T> {
  const maxAttempts = policy.retrySafe ? (policy.maxAttempts ?? 3) : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      const isDeadlockOrSerialization = code === '40P01' || code === '40001';
      if (!isDeadlockOrSerialization || !policy.retrySafe || attempt >= maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError;
}
