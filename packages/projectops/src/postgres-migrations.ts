import { readFile } from 'node:fs/promises';
import { computeMigrationChecksum, type MigrationItem } from '../../db/src/migrations/index.ts';

export interface MigrationConnection {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// This SQL artifact is immutable once deployed. Add a new version for upgrades.
export async function loadProjectOpsPostgresMigrations(): Promise<readonly MigrationItem[]> {
  return [{
    version: '0001',
    name: 'projectops_foundation',
    upSql: await readFile(new URL('../migrations/0001_projectops_foundation.sql', import.meta.url), 'utf8'),
    reversible: false,
  }, {
    version: '0002',
    name: 'operator_access',
    upSql: await readFile(new URL('../migrations/0002_operator_access.sql', import.meta.url), 'utf8'),
    reversible: false,
  }, {
    version: '0003',
    name: 'client_management',
    upSql: await readFile(new URL('../migrations/0003_client_management.sql', import.meta.url), 'utf8'),
    reversible: false,
  }, {
    version: '0004',
    name: 'project_workspace',
    upSql: await readFile(new URL('../migrations/0004_project_workspace.sql', import.meta.url), 'utf8'),
    reversible: false,
  }, {
    version: '0005',
    name: 'project_controls',
    upSql: await readFile(new URL('../migrations/0005_project_controls.sql', import.meta.url), 'utf8'),
    reversible: false,
  }, {
    version: '0006',
    name: 'project_planning',
    upSql: await readFile(new URL('../migrations/0006_project_planning.sql', import.meta.url), 'utf8'),
    reversible: false,
  }];
}

export async function migrateProjectOpsPostgres(
  connection: MigrationConnection,
  migrations: readonly MigrationItem[]
): Promise<readonly string[]> {
  const ordered = [...migrations].sort((a, b) => a.version.localeCompare(b.version));
  if (new Set(ordered.map(m => m.version)).size !== ordered.length) {
    throw new Error('Duplicate ProjectOps migration version.');
  }
  await connection.query('BEGIN');
  try {
    await connection.query("SET LOCAL lock_timeout = '10s'");
    await connection.query('SELECT pg_advisory_xact_lock(734102, 1)');
    const existing = await connection.query(`SELECT
      to_regclass('projectops_schema_migrations') AS ledger,
      to_regclass('projectops_clients') AS clients`);
    if (!existing.rows[0]?.ledger && existing.rows[0]?.clients) {
      throw new Error('Unmanaged ProjectOps schema: back up and explicitly migrate legacy data before starting.');
    }
    await connection.query(`CREATE TABLE IF NOT EXISTS projectops_schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const ledger = await connection.query(
      'SELECT version, name, checksum FROM projectops_schema_migrations ORDER BY version'
    );
    const records = new Map(ledger.rows.map(row => [String(row.version), row]));
    for (const row of ledger.rows) {
      const migration = ordered.find(m => m.version === row.version);
      if (!migration || row.name !== migration.name || row.checksum !== computeMigrationChecksum(migration.upSql)) {
        throw new Error(`Unknown or changed ProjectOps migration: ${row.version}.`);
      }
    }
    // Reject inserting older migrations beneath an already applied version.
    const latest = ledger.rows.at(-1)?.version;
    const applied: string[] = [];
    for (const migration of ordered) {
      if (records.has(migration.version)) continue;
      if (latest && migration.version < String(latest)) {
        throw new Error(`Out-of-order ProjectOps migration: ${migration.version}.`);
      }
      await connection.query(migration.upSql);
      await connection.query(
        'INSERT INTO projectops_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, computeMigrationChecksum(migration.upSql)]
      );
      applied.push(migration.version);
    }
    await connection.query('COMMIT');
    return Object.freeze(applied);
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
}
