// EXEC-FOUND-017: In-Flight Request Draining
export interface DrainResult {
  completedGracefully: boolean;
  remainingInFlight: number;
  elapsedMs: number;
}

export class InFlightDrainer {
  private inFlightCount = 0;
  private draining = false;
  private waiters: Array<() => void> = [];

  public isDraining(): boolean {
    return this.draining;
  }

  public getInFlightCount(): number {
    return this.inFlightCount;
  }

  public tryEnter(): boolean {
    if (this.draining) {
      return false;
    }
    this.inFlightCount += 1;
    return true;
  }

  public leave(): void {
    if (this.inFlightCount > 0) {
      this.inFlightCount -= 1;
    }
    if (this.draining && this.inFlightCount === 0) {
      const currentWaiters = this.waiters.splice(0, this.waiters.length);
      for (const resolve of currentWaiters) {
        resolve();
      }
    }
  }

  public async drain(deadlineMs: number): Promise<DrainResult> {
    if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) {
      throw new Error('drain deadlineMs must be a positive integer');
    }
    this.draining = true;
    const started = Date.now();

    if (this.inFlightCount === 0) {
      return { completedGracefully: true, remainingInFlight: 0, elapsedMs: 0 };
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const drainedPromise = new Promise<boolean>((resolve) => {
      this.waiters.push(() => resolve(true));
    });
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(false), deadlineMs);
    });

    const completedGracefully = await Promise.race([drainedPromise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    return {
      completedGracefully,
      remainingInFlight: this.inFlightCount,
      elapsedMs: Math.max(0, Date.now() - started),
    };
  }
}

export function inFlightRequestDraining(): InFlightDrainer {
  return new InFlightDrainer();
}
