// Dead-Letter Queue Isolation & Inspection
import type { JobEnvelope } from '../contracts/job.ts';

export interface DeadLetterEntry<TPayload = Record<string, unknown>> {
  readonly job: JobEnvelope<TPayload>;
  readonly failureCategory: 'transient' | 'permanent' | 'poison_pill';
  readonly failureReason: string;
  readonly quarantinedAtMs: number;
}

export class DeadLetterQueue {
  private readonly entries = new Map<string, DeadLetterEntry>();

  public quarantine(entry: DeadLetterEntry): void {
    this.entries.set(entry.job.jobId, Object.freeze({ ...entry }));
  }

  public inspectAll(): ReadonlyArray<DeadLetterEntry> {
    return Object.freeze(Array.from(this.entries.values()));
  }

  public getById(jobId: string): DeadLetterEntry | undefined {
    return this.entries.get(jobId);
  }

  public remove(jobId: string): DeadLetterEntry | undefined {
    const existing = this.entries.get(jobId);
    this.entries.delete(jobId);
    return existing;
  }
}
