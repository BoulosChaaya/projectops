// EXEC-CACHE-011: Cache Stampede Protection (Single-Flight Coalescing)
export class SingleFlightCoalescer {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  public async execute<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return (await existing) as T;
    }

    const promise = (async () => {
      try {
        return await loader();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return await promise;
  }

  public getInFlightCount(): number {
    return this.inFlight.size;
  }
}

export const defaultStampedeCoalescer = new SingleFlightCoalescer();

export async function withStampedeProtection<T>(
  key: string,
  loader: () => Promise<T>,
  coalescer: SingleFlightCoalescer = defaultStampedeCoalescer
): Promise<T> {
  return await coalescer.execute(key, loader);
}
