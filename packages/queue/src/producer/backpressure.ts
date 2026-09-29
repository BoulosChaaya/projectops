// Queue Depth Monitoring & Backpressure Signaling
export class QueueBackpressureError extends Error {
  public readonly code = 'QUEUE_BACKPRESSURE_REJECTED';
  public readonly currentDepth: number;
  public readonly maxDepth: number;

  constructor(currentDepth: number, maxDepth: number) {
    super(`Queue backpressure limit reached (depth=${currentDepth}, max=${maxDepth}).`);
    this.name = 'QueueBackpressureError';
    this.currentDepth = currentDepth;
    this.maxDepth = maxDepth;
  }
}

export function assertQueueCapacity(currentDepth: number, maxDepth: number): void {
  if (currentDepth >= maxDepth) {
    throw new QueueBackpressureError(currentDepth, maxDepth);
  }
}
