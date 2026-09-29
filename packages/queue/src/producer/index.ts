// Repository-Owned Queue Broker & Job Producer
import {
  createJobEnvelope,
  type CreateJobInput,
  type JobEnvelope,
} from '../contracts/job.ts';
import { assertQueueCapacity } from './backpressure.ts';
import { DeadLetterQueue } from '../dlq/index.ts';

export interface ActiveLease {
  readonly job: JobEnvelope;
  readonly workerId: string;
  expiresAtMs: number;
}

export class QueueBroker {
  private readonly maxDepth: number;
  private readonly pending: JobEnvelope[] = [];
  private readonly leases = new Map<string, ActiveLease>();
  public readonly dlq = new DeadLetterQueue();

  constructor(options: { maxDepth?: number } = {}) {
    this.maxDepth = options.maxDepth ?? 10_000;
  }

  public async enqueue<TPayload extends Record<string, unknown>>(
    input: CreateJobInput<TPayload>
  ): Promise<JobEnvelope<TPayload>> {
    assertQueueCapacity(this.pending.length, this.maxDepth);
    const envelope = createJobEnvelope(input);
    this.pending.push(envelope);
    return envelope;
  }

  public async enqueueRaw(envelope: JobEnvelope): Promise<void> {
    assertQueueCapacity(this.pending.length, this.maxDepth);
    this.pending.push(envelope);
  }

  public getMetrics(nowMs: number = Date.now()): {
    readonly pendingDepth: number;
    readonly readyDepth: number;
    readonly activeLeases: number;
    readonly dlqDepth: number;
  } {
    const readyDepth = this.pending.filter((j) => j.availableAtMs <= nowMs).length;
    return Object.freeze({
      pendingDepth: this.pending.length,
      readyDepth,
      activeLeases: this.leases.size,
      dlqDepth: this.dlq.inspectAll().length,
    });
  }

  public claimNext(
    queueName: string,
    workerId: string,
    leaseDurationMs = 30_000,
    nowMs: number = Date.now()
  ): JobEnvelope | null {
    // Reclaim any expired leases first
    for (const [jobId, lease] of this.leases.entries()) {
      if (lease.expiresAtMs <= nowMs) {
        this.leases.delete(jobId);
        this.pending.push(lease.job);
      }
    }

    // Respect partition ordering: do not claim a job if its partitionKey already has an active lease
    const activePartitions = new Set<string>();
    for (const lease of this.leases.values()) {
      if (lease.job.partitionKey) {
        activePartitions.add(lease.job.partitionKey);
      }
    }

    const idx = this.pending.findIndex(
      (j) =>
        j.queueName === queueName &&
        j.availableAtMs <= nowMs &&
        (!j.partitionKey || !activePartitions.has(j.partitionKey))
    );

    if (idx === -1) return null;

    const [claimed] = this.pending.splice(idx, 1);
    const updatedJob: JobEnvelope = Object.freeze({
      ...claimed,
      attemptsMade: claimed.attemptsMade + 1,
    });

    this.leases.set(updatedJob.jobId, {
      job: updatedJob,
      workerId,
      expiresAtMs: nowMs + leaseDurationMs,
    });

    return updatedJob;
  }

  public renewLease(
    jobId: string,
    workerId: string,
    extensionMs = 30_000,
    nowMs: number = Date.now()
  ): boolean {
    const lease = this.leases.get(jobId);
    if (!lease || lease.workerId !== workerId) return false;
    lease.expiresAtMs = nowMs + extensionMs;
    return true;
  }

  public completeJob(jobId: string, workerId: string): void {
    const lease = this.leases.get(jobId);
    if (lease && lease.workerId === workerId) {
      this.leases.delete(jobId);
    }
  }

  public rescheduleOrQuarantine(
    jobId: string,
    workerId: string,
    decision: {
      readonly action: 'retry' | 'dead_letter';
      readonly nextDelayMs: number;
      readonly category: 'transient' | 'permanent' | 'poison_pill';
      readonly reason: string;
    },
    nowMs: number = Date.now()
  ): void {
    const lease = this.leases.get(jobId);
    if (!lease || lease.workerId !== workerId) return;
    this.leases.delete(jobId);

    if (decision.action === 'retry') {
      const rescheduled: JobEnvelope = Object.freeze({
        ...lease.job,
        availableAtMs: nowMs + decision.nextDelayMs,
      });
      this.pending.push(rescheduled);
    } else {
      this.dlq.quarantine({
        job: lease.job,
        failureCategory: decision.category,
        failureReason: decision.reason,
        quarantinedAtMs: nowMs,
      });
    }
  }
}
