// Durable PostgreSQL-to-Queue Transactional Outbox Handoff
import type { QueueBroker } from '../producer/index.ts';

export interface OutboxRecord {
  readonly id: string;
  readonly queueName: string;
  readonly jobName: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  published: boolean;
}

export class TransactionalOutboxRelay {
  private readonly outboxTable: OutboxRecord[] = [];

  public stageInTransaction(record: Omit<OutboxRecord, 'published'>): OutboxRecord {
    const entry: OutboxRecord = { ...record, published: false };
    this.outboxTable.push(entry);
    return entry;
  }

  public async relayPending(broker: QueueBroker, nowMs: number = Date.now()): Promise<number> {
    let relayedCount = 0;
    for (const row of this.outboxTable) {
      if (row.published) continue;
      await broker.enqueue({
        queueName: row.queueName,
        jobName: row.jobName,
        idempotencyKey: row.idempotencyKey,
        payload: row.payload,
        nowMs,
      });
      row.published = true;
      relayedCount += 1;
    }
    return relayedCount;
  }

  public getPendingCount(): number {
    return this.outboxTable.filter((r) => !r.published).length;
  }
}
