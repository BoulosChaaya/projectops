// EXEC-TEST-016..026: Concurrent Race Barrier & Deterministic Chaos Fault Injection
export async function runConcurrentRace<T>(
  tasks: ReadonlyArray<() => Promise<T>>
): Promise<ReadonlyArray<PromiseSettledResult<T>>> {
  let releaseGate!: () => void;
  const startSignal = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const wrapped = tasks.map(async (fn) => {
    await startSignal;
    return await fn();
  });

  releaseGate();
  return await Promise.allSettled(wrapped);
}

export class FaultInjector {
  private readonly activeFaults = new Map<string, Error>();

  public armFault(targetOperation: string, error: Error): void {
    this.activeFaults.set(targetOperation, error);
  }

  public disarmFault(targetOperation: string): void {
    this.activeFaults.delete(targetOperation);
  }

  public maybeThrow(targetOperation: string): void {
    const err = this.activeFaults.get(targetOperation);
    if (err) {
      throw err;
    }
  }
}
