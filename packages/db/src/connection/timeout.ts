// EXEC-DB-003: Connection Timeout Handling
export class DatabaseConnectTimeoutError extends Error {
  public readonly code = 'ETIMEDOUT';
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Database connection attempt timed out after ${timeoutMs}ms.`);
    this.name = 'DatabaseConnectTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function withConnectDeadline<T>(
  timeoutMs: number,
  attempt: (signal: AbortSignal) => Promise<T>,
  onCancel?: () => void | Promise<void>
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('connectionTimeoutMs must be a positive integer.');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(async () => {
      controller.abort();
      if (onCancel) {
        await onCancel();
      }
      reject(new DatabaseConnectTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempt(controller.signal), deadlinePromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
