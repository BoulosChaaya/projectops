import { Pool } from 'pg';
import { ProjectOpsConnectionSqlExecutor } from '../../../../packages/projectops/src/executor.ts';
import {
  loadProjectOpsPostgresMigrations,
  migrateProjectOpsPostgres,
} from '../../../../packages/projectops/src/postgres-migrations.ts';
import { startProjectOpsApp, type ProjectOpsApp } from './app.ts';
import { HealthService } from '../health/health.service.ts';

export interface ProjectOpsRuntimeConfig {
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
}

export function readProjectOpsRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ProjectOpsRuntimeConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must identify a PostgreSQL server and database.');
  }
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535) throw new Error('Invalid PORT.');
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('Invalid HOST.');
  return Object.freeze({ databaseUrl: env.DATABASE_URL, host, port: Number(rawPort) });
}

export async function startProjectOpsPostgresApp(
  config: ProjectOpsRuntimeConfig
): Promise<ProjectOpsApp> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
  });
  // pg emits idle-client errors; do not expose credentials or crash on an unhandled event.
  pool.on('error', () => console.error('ProjectOps database connection failed.'));
  let app: ProjectOpsApp | undefined;
  try {
    const sql = new ProjectOpsConnectionSqlExecutor({
      async query<T>(text: string, params: readonly unknown[] = []) {
        const result = await pool.query(text, [...params]);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command };
      },
    });
    app = await startProjectOpsApp({
      sql,
      host: config.host,
      port: config.port,
      healthService: new HealthService([{
        name: 'postgres',
        async check() {
          await pool.query('SELECT 1');
          return true;
        },
      }]),
      async migrate() {
        const client = await pool.connect();
        try {
          await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations());
        } finally { client.release(); }
      },
    });
    const started = app;
    let closing: Promise<void> | undefined;
    return Object.freeze({
      server: started.server,
      routes: started.routes,
      close() {
        closing ??= (async () => {
          try { await started.close(); } finally { await pool.end(); }
        })();
        return closing;
      },
    });
  } catch (error) {
    if (app) await app.close();
    await pool.end();
    throw error;
  }
}
