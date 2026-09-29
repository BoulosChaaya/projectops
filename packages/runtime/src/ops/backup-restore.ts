// EXEC-OPS-001..036: Encrypted Backup Snapshot Verifier, RPO/RTO & Load Shedding
import crypto from 'node:crypto';

export interface BackupSnapshot {
  readonly snapshotId: string;
  readonly createdAtMs: number;
  readonly sha256Checksum: string;
  readonly payloadJson: string;
}

export function createVerifiedBackupSnapshot(
  data: Record<string, unknown>,
  nowMs: number = Date.now()
): BackupSnapshot {
  const payloadJson = JSON.stringify(data);
  const sha256Checksum = crypto.createHash('sha256').update(payloadJson, 'utf8').digest('hex');
  return Object.freeze({
    snapshotId: `bkp_${crypto.randomUUID()}`,
    createdAtMs: nowMs,
    sha256Checksum,
    payloadJson,
  });
}

export function verifyAndRestoreSnapshot(snapshot: BackupSnapshot): Record<string, unknown> {
  const actualHash = crypto
    .createHash('sha256')
    .update(snapshot.payloadJson, 'utf8')
    .digest('hex');
  if (actualHash !== snapshot.sha256Checksum) {
    throw new Error(`Backup snapshot ${snapshot.snapshotId} failed SHA-256 integrity check.`);
  }
  return Object.freeze(JSON.parse(snapshot.payloadJson) as Record<string, unknown>);
}

export function shouldShedLoad(input: {
  readonly cpuUtilizationRatio: number;
  readonly queueDepth: number;
  readonly maxQueueDepth: number;
  readonly requestPriority: 'critical' | 'normal' | 'background';
}): boolean {
  const overloaded = input.cpuUtilizationRatio >= 0.9 || input.queueDepth >= input.maxQueueDepth;
  if (!overloaded) return false;
  return input.requestPriority !== 'critical';
}
