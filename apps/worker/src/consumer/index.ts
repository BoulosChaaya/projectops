// EXEC-QUEUE-039: Asynchronous Worker Consumer Runtime
import type { JobEnvelope } from '../../../../packages/queue/src/contracts/job.ts';
import type { QueueBroker } from '../../../../packages/queue/src/producer/index.ts';
import { IdempotencyStore } from '../../../../packages/queue/src/idempotency/index.ts';
import { assertNotPoisonPayload } from '../../../../packages/queue/src/dlq/poison.ts';
import { evaluateRetryPolicy, type BackoffConfig } from '../../../../packages/queue/src/retry/policy.ts';

export type JobHandler<TPayload = Record<string, unknown>> = (
  job: JobEnvelope<TPayload>,
  helpers: { renewLease: () => boolean }
) => Promise<unknown>;

export interface WorkerRuntimeOptions {
  readonly workerId: string;
  readonly queueName: string;
  readonly broker: QueueBroker;
  readonly idempotencyStore?: IdempotencyStore;
  readonly maxConcurrency?: number;
  readonly jobTimeoutMs?: number;
  readonly backoffConfig?: BackoffConfig;
  readonly nowFn?: () => number;
}

export class WorkerRuntime {
  private readonly workerId: string;
  private readonly queueName: string;
  private readonly broker: QueueBroker;
  private readonly idempotency: IdempotencyStore;
  private readonly maxConcurrency: number;
  private readonly jobTimeoutMs: number;
  private readonly backoffConfig: BackoffConfig;
  private readonly nowFn: () => number;
  private readonly handlers = new Map<string, JobHandler>();
  private activeJobs = 0;
  private draining = false;

  constructor(options: WorkerRuntimeOptions) {
    this.workerId = options.workerId;
    this.queueName = options.queueName;
    this.broker = options.broker;
    this.idempotency = options.idempotencyStore ?? new IdempotencyStore();
    this.maxConcurrency = options.maxConcurrency ?? 5;
    this.jobTimeoutMs = options.jobTimeoutMs ?? 10_000;
    this.backoffConfig = options.backoffConfig ?? { baseDelayMs: 50, maxDelayMs: 5_000 };
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  public registerHandler(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
  }

  public async processNext(): Promise<{
    readonly processed: boolean;
    readonly status?: 'completed' | 'deduplicated' | 'retried' | 'dead_lettered';
    readonly jobId?: string;
  }> {
    if (this.draining || this.activeJobs >= this.maxConcurrency) {
      return Object.freeze({ processed: false });
    }

    const nowMs = this.nowFn();
    const job = this.broker.claimNext(this.queueName, this.workerId, 30_000, nowMs);
    if (!job) {
      return Object.freeze({ processed: false });
    }

    this.activeJobs += 1;
    try {
      // 1. Poison-pill detection before handler invocation
      assertNotPoisonPayload(job.payload);

      // 2. Idempotency check (at-most-once side effects)
      const idem = this.idempotency.tryAcquire(job.idempotencyKey, nowMs);
      if (idem.alreadyCompleted) {
        this.broker.completeJob(job.jobId, this.workerId);
        return Object.freeze({ processed: true, status: 'deduplicated', jobId: job.jobId });
      }

      const handler = this.handlers.get(job.jobName);
      if (!handler) {
        throw new Error(`No worker handler registered for jobName "${job.jobName}".`);
      }

      // 3. Execute handler with per-job timeout deadline
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`Job ${job.jobId} timed out after ${this.jobTimeoutMs}ms.`);
          (err as { code?: string; transient?: boolean }).code = 'ETIMEDOUT';
          (err as { transient?: boolean }).transient = true;
          reject(err);
        }, this.jobTimeoutMs);
      });

      const result = await Promise.race([
        handler(job, {
          renewLease: () => this.broker.renewLease(job.jobId, this.workerId, 30_000, this.nowFn()),
        }),
        timeoutPromise,
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      this.idempotency.markCompleted(job.idempotencyKey, result, this.nowFn());
      this.broker.completeJob(job.jobId, this.workerId);
      return Object.freeze({ processed: true, status: 'completed', jobId: job.jobId });
    } catch (error) {
      this.idempotency.releaseOnFailure(job.idempotencyKey);
      const decision = evaluateRetryPolicy(
        error,
        job.attemptsMade,
        job.maxAttempts,
        this.backoffConfig,
        () => 0.5
      );
      const reason = error instanceof Error ? error.message : String(error);
      this.broker.rescheduleOrQuarantine(
        job.jobId,
        this.workerId,
        { ...decision, reason },
        this.nowFn()
      );
      return Object.freeze({
        processed: true,
        status: decision.action === 'retry' ? 'retried' : 'dead_lettered',
        jobId: job.jobId,
      });
    } finally {
      this.activeJobs = Math.max(0, this.activeJobs - 1);
    }
  }

  public async drain(deadlineMs = 5000): Promise<{ drainedCleanly: boolean }> {
    this.draining = true;
    const start = Date.now();
    while (this.activeJobs > 0 && Date.now() - start < deadlineMs) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return Object.freeze({ drainedCleanly: this.activeJobs === 0 });
  }
}
