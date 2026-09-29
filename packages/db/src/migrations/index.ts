// EXEC-DB-042: Schema Evolution
import crypto from 'node:crypto';
import type { HandshakeCapableClient } from '../connection/handshake.ts';
import { MigrationLockMutex } from './concurrency.ts';

export interface MigrationItem {
  readonly version: string;
  readonly name: string;
  readonly upSql: string;
  readonly downSql?: string;
  readonly reversible?: boolean;
}

export interface AppliedMigrationRecord {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  readonly currentVersion: string | null;
}

export function computeMigrationChecksum(sql: string): string {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

export class MigrationRunner {
  private readonly client: HandshakeCapableClient;
  private readonly migrations: readonly MigrationItem[];
  private readonly ledger = new Map<string, AppliedMigrationRecord>();
  private readonly mutex: MigrationLockMutex;

  constructor(
    client: HandshakeCapableClient,
    migrations: readonly MigrationItem[],
    mutex: MigrationLockMutex = new MigrationLockMutex()
  ) {
    this.client = client;
    this.migrations = [...migrations].sort((a, b) => a.version.localeCompare(b.version));
    this.mutex = mutex;
  }

  public getAppliedLedger(): ReadonlyArray<AppliedMigrationRecord> {
    return Object.freeze(Array.from(this.ledger.values()));
  }

  public verifyChecksums(): void {
    for (const mig of this.migrations) {
      const existing = this.ledger.get(mig.version);
      if (existing) {
        const expected = computeMigrationChecksum(mig.upSql);
        if (existing.checksum !== expected) {
          throw new Error(
            `Migration checksum drift detected for version ${mig.version} (${mig.name}).`
          );
        }
      }
    }
  }

  public async runUp(targetVersion?: string): Promise<MigrationResult> {
    return await this.mutex.withAdvisoryLock(async () => {
      this.verifyChecksums();
      const applied: string[] = [];
      const skipped: string[] = [];

      for (const mig of this.migrations) {
        if (targetVersion && mig.version > targetVersion) {
          break;
        }
        if (this.ledger.has(mig.version)) {
          skipped.push(mig.version);
          continue;
        }
        await this.client.query(mig.upSql);
        this.ledger.set(mig.version, {
          version: mig.version,
          name: mig.name,
          checksum: computeMigrationChecksum(mig.upSql),
          appliedAt: new Date().toISOString(),
        });
        applied.push(mig.version);
      }

      const keys = Array.from(this.ledger.keys()).sort();
      return Object.freeze({
        applied: Object.freeze(applied),
        skipped: Object.freeze(skipped),
        currentVersion: keys.length > 0 ? keys[keys.length - 1] : null,
      });
    });
  }

  public async runDown(targetVersion: string): Promise<MigrationResult> {
    return await this.mutex.withAdvisoryLock(async () => {
      const appliedVersions = Array.from(this.ledger.keys()).sort().reverse();
      const reverted: string[] = [];

      for (const ver of appliedVersions) {
        if (ver <= targetVersion) break;
        const mig = this.migrations.find((m) => m.version === ver);
        if (!mig || mig.reversible === false || !mig.downSql) {
          throw new Error(`Migration ${ver} is marked irreversible and cannot roll back.`);
        }
        await this.client.query(mig.downSql);
        this.ledger.delete(ver);
        reverted.push(ver);
      }

      const keys = Array.from(this.ledger.keys()).sort();
      return Object.freeze({
        applied: Object.freeze(reverted),
        skipped: Object.freeze([]),
        currentVersion: keys.length > 0 ? keys[keys.length - 1] : null,
      });
    });
  }
}
