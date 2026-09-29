// EXEC-ARCH-010..024: Downstream Deadline Budget Reduction & Bulkhead Isolation
export function propagateDownstreamDeadline(
  remainingCallerBudgetMs: number,
  networkOverheadReserveMs = 25
): number {
  const downstreamBudget = remainingCallerBudgetMs - networkOverheadReserveMs;
  if (downstreamBudget <= 0) {
    throw new Error('Caller deadline budget exhausted before downstream call dispatch.');
  }
  return downstreamBudget;
}

export class BulkheadCompartment {
  private readonly name: string;
  private readonly maxConcurrent: number;
  private active = 0;

  constructor(name: string, maxConcurrent: number) {
    this.name = name;
    this.maxConcurrent = maxConcurrent;
  }

  public async execute<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      throw new Error(`Bulkhead compartment ${this.name} is full (max=${this.maxConcurrent}).`);
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active = Math.max(0, this.active - 1);
    }
  }
}
