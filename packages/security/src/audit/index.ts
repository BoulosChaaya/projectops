// EXEC-SEC-043..046: Append-Only Tamper-Evident HMAC Audit Trail
import crypto from 'node:crypto';

export interface AuditEventInput {
  readonly actorId: string;
  readonly action: string;
  readonly resource: string;
  readonly outcome: 'allowed' | 'denied';
  readonly timestampIso?: string;
}

export interface AuditRecord extends AuditEventInput {
  readonly sequence: number;
  readonly timestampIso: string;
  readonly prevHmac: string;
  readonly hmac: string;
}

export class TamperEvidentAuditLog {
  private readonly secretKey: Buffer;
  private readonly chain: AuditRecord[] = [];

  constructor(secretKey: string | Buffer) {
    this.secretKey = Buffer.isBuffer(secretKey)
      ? Buffer.from(secretKey)
      : Buffer.from(secretKey, 'utf8');
  }

  private computeHmac(
    sequence: number,
    prevHmac: string,
    event: Required<AuditEventInput>
  ): string {
    const payload = `${sequence}|${prevHmac}|${event.timestampIso}|${event.actorId}|${event.action}|${event.resource}|${event.outcome}`;
    return crypto.createHmac('sha256', this.secretKey).update(payload, 'utf8').digest('hex');
  }

  public append(input: AuditEventInput): AuditRecord {
    const sequence = this.chain.length + 1;
    const prevHmac = sequence === 1 ? '0'.repeat(64) : this.chain[this.chain.length - 1].hmac;
    const timestampIso = input.timestampIso ?? new Date().toISOString();
    const fullEvent: Required<AuditEventInput> = {
      actorId: input.actorId,
      action: input.action,
      resource: input.resource,
      outcome: input.outcome,
      timestampIso,
    };
    const hmac = this.computeHmac(sequence, prevHmac, fullEvent);
    const record: AuditRecord = Object.freeze({
      sequence,
      ...fullEvent,
      prevHmac,
      hmac,
    });
    this.chain.push(record);
    return record;
  }

  public getRecords(): ReadonlyArray<AuditRecord> {
    return Object.freeze([...this.chain]);
  }

  public verifyChain(records: readonly AuditRecord[] = this.chain): {
    valid: boolean;
    brokenAtSequence?: number;
  } {
    let expectedPrev = '0'.repeat(64);
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (rec.sequence !== i + 1 || rec.prevHmac !== expectedPrev) {
        return Object.freeze({ valid: false, brokenAtSequence: i + 1 });
      }
      const recomputed = this.computeHmac(rec.sequence, rec.prevHmac, {
        actorId: rec.actorId,
        action: rec.action,
        resource: rec.resource,
        outcome: rec.outcome,
        timestampIso: rec.timestampIso,
      });
      if (recomputed !== rec.hmac) {
        return Object.freeze({ valid: false, brokenAtSequence: rec.sequence });
      }
      expectedPrev = rec.hmac;
    }
    return Object.freeze({ valid: true });
  }
}
