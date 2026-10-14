import { Pool } from 'pg';
import { ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection } from '../../../../packages/projectops/src/executor.ts';
import {
  loadProjectOpsPostgresMigrations,
  migrateProjectOpsPostgres,
} from '../../../../packages/projectops/src/postgres-migrations.ts';
import { startProjectOpsApp, type ProjectOpsApp } from './app.ts';
import { HealthService } from '../health/health.service.ts';
import { ProjectOpsOperatorStore } from '../../../../packages/projectops/src/operator.ts';
import { ProjectOpsAccess } from './access.ts';
import { createLogger, describeError, type Logger } from '../../../../packages/logger/src/index.ts';

export interface ProjectOpsRuntimeConfig {
  readonly databaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly publicOrigin?: string;
  /**
   * Optional source of "now" for application timestamps (record creation, audit history,
   * dashboard evaluation). Production never sets it — readProjectOpsRuntimeConfig omits it,
   * so the wall clock is used. Acceptance tests pin it to stay deterministic over time.
   * Session expiry and login limits use PostgreSQL NOW() and are unaffected.
   */
  readonly clock?: () => string;
  /** Structured log destination; production uses JSON lines on stdout. Tests capture records. */
  readonly logger?: Logger;
  /** Git commit of the running code, reported by GET /health/live (Render sets RENDER_GIT_COMMIT). */
  readonly commit?: string;
}

export function validateProjectOpsOrigin(host: string, value?: string): string | undefined {
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!value) {
    if (!local) throw new Error('PUBLIC_ORIGIN with HTTPS is required for a non-loopback HOST.');
    return undefined;
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid PUBLIC_ORIGIN.'); }
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (HTTP is allowed only on loopback).');
  return value;
}

/** DATABASE_URL alone: what commands that do not serve HTTP (operator provisioning) need. */
export function readProjectOpsDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must identify a PostgreSQL server and database.');
  }
  return env.DATABASE_URL;
}

export function readProjectOpsRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): ProjectOpsRuntimeConfig {
  const databaseUrl = readProjectOpsDatabaseUrl(env);
  const rawPort = env.PORT ?? '3000';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) > 65535) throw new Error('Invalid PORT.');
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('Invalid HOST.');
  // The commit is informational; anything but a full SHA is ignored rather than echoed publicly.
  const commit = /^[0-9a-f]{40}$/.test(env.RENDER_GIT_COMMIT ?? '') ? env.RENDER_GIT_COMMIT : undefined;
  return Object.freeze({ databaseUrl, host, port: Number(rawPort), publicOrigin: validateProjectOpsOrigin(host, env.PUBLIC_ORIGIN),
    ...(commit ? { commit } : {}) });
}

export async function startProjectOpsPostgresApp(
  config: ProjectOpsRuntimeConfig
): Promise<ProjectOpsApp> {
  validateProjectOpsOrigin(config.host, config.publicOrigin);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
  });
  const logger = config.logger ?? createLogger({ minLevel: 'info' });
  // pg emits errors for idle pooled connections (for example when PostgreSQL restarts). Handle the
  // event so it cannot crash the process, and log it structurally: it is often the first sign of
  // an outage. describeError redacts connection-string credentials.
  pool.on('error', error => logger.error('db.pool.error', { error: describeError(error, { stack: false }) }));
  let app: ProjectOpsApp | undefined;
  try {
    const sql = new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool));
    app = await startProjectOpsApp({
      sql,
      host: config.host,
      port: config.port,
      clock: config.clock,
      logger,
      access: new ProjectOpsAccess(new ProjectOpsOperatorStore(pool), config.publicOrigin),
      healthService: new HealthService([{
        name: 'postgres',
        async check() {
          await pool.query('SELECT 1');
          return true;
        },
      }], config.commit ? { commit: config.commit } : undefined),
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
