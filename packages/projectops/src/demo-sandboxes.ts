import { createHash, randomBytes } from 'node:crypto';
import type { MigrationItem } from '../../db/src/migrations/index.ts';
import { ProjectOpsConnectionSqlExecutor, type ProjectOpsQueryConnection } from './executor.ts';
import { migrateProjectOpsPostgres } from './postgres-migrations.ts';
import { DEMO_LOGIN, seedDemoAgency } from './demo-seed.ts';
import { validateOperatorDefaults, type OperatorDefaults, type OperatorSession } from './operator.ts';
import type { ProjectOpsSqlExecutor } from './repository.ts';

// Demo sandboxes: each visitor who chooses "Explore the demo" gets a private copy of a seeded
// studio in a PostgreSQL schema of their own (demo_<24 hex>). Every query for their session runs
// in a transaction whose search_path is that schema alone, so their reads and writes cannot reach
// the operator's data (public is not on the path: a table missing from the sandbox is an error,
// never a fall-back). One row per sandbox in projectops_demo_sandboxes, in the main schema, is
// the only record of which schemas exist and when they expire; a sweeper drops expired ones.

const SCHEMA = /^demo_[a-f0-9]{24}$/;
/** Demo session tokens carry a prefix, so they can never be read as operator tokens (43 characters). */
export const DEMO_TOKEN = /^demo\.[A-Za-z0-9_-]{43}$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function validTimezone(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 100) return undefined;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return undefined; }
}

export interface DemoSandboxLimits {
  /** How long a sandbox lives from its start; resets do not extend it. */
  readonly lifetimeMinutes: number;
  /** Sandboxes alive at once, across all visitors. */
  readonly maxLive: number;
  /** New sandboxes within `windowMinutes`, across all visitors. */
  readonly maxPerWindow: number;
  readonly windowMinutes: number;
  /** Minimum time between two resets of one sandbox. */
  readonly resetCooldownSeconds: number;
}
export const DEFAULT_DEMO_LIMITS: DemoSandboxLimits = Object.freeze({
  lifetimeMinutes: 120, maxLive: 30, maxPerWindow: 20, windowMinutes: 10, resetCooldownSeconds: 30,
});

export interface DemoSession extends OperatorSession {
  readonly demo: { readonly schema: string; readonly expiresAtIso: string };
}

interface Rows { rows: any[] }
export interface DemoPoolClient { query(sql: string, params?: unknown[]): Promise<Rows>; release(): void }
export interface DemoPool { query(sql: string, params?: unknown[]): Promise<Rows>; connect(): Promise<DemoPoolClient> }
/** A dedicated connection, outside the pool, for building a sandbox (it changes the session's search_path). */
export interface DemoBuildClient { query(sql: string, params?: unknown[]): Promise<Rows>; end(): Promise<void> }

export type DemoStart = { readonly rawToken: string; readonly csrfToken: string; readonly expiresAtIso: string } | 'busy';

/**
 * A query connection confined to one sandbox schema. Each statement (or composed transaction)
 * runs as BEGIN; set search_path for this transaction only; …; COMMIT, so the setting can never
 * outlive the transaction and leak to the next user of the pooled connection.
 */
export function projectOpsSandboxConnection(pool: DemoPool, schema: string): ProjectOpsQueryConnection {
  if (!SCHEMA.test(schema)) throw new Error('Invalid demo sandbox schema.');
  async function scoped<T>(run: (client: DemoPoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SELECT set_config('search_path', $1, true)", [schema]);
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  const rows = async <T>(client: DemoPoolClient, sql: string, params: readonly unknown[]) => {
    const result = await client.query(sql, [...params]) as Rows & { rowCount?: number | null; command?: string };
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command ?? '' };
  };
  return {
    query: <T>(sql: string, params: readonly unknown[] = []) => scoped(client => rows<T>(client, sql, params)),
    transaction: run => scoped(client => run({ query: (sql, params = []) => rows(client, sql, params) })),
  };
}

export class ProjectOpsDemoSandboxes {
  private readonly pool: DemoPool;
  private readonly openBuildClient: () => Promise<DemoBuildClient>;
  private readonly migrations: readonly MigrationItem[];
  readonly limits: DemoSandboxLimits;
  private readonly now: () => Date;

  constructor(options: {
    pool: DemoPool; openBuildClient: () => Promise<DemoBuildClient>; migrations: readonly MigrationItem[];
    limits?: Partial<DemoSandboxLimits>; now?: () => Date;
  }) {
    this.pool = options.pool;
    this.openBuildClient = options.openBuildClient;
    this.migrations = options.migrations;
    this.limits = Object.freeze({ ...DEFAULT_DEMO_LIMITS, ...options.limits });
    this.now = options.now ?? (() => new Date());
  }

  /** The executor for a sandbox's data. */
  executor(schema: string): ProjectOpsSqlExecutor {
    return new ProjectOpsConnectionSqlExecutor(projectOpsSandboxConnection(this.pool, schema));
  }

  /**
   * Reserve a sandbox within the limits, then build and seed it. 'busy' when a limit is reached.
   * `timezone` (the visitor's, from their browser) becomes the sandbox's display timezone when it
   * is a valid IANA name; otherwise the sandbox shows UTC.
   */
  async start(options: { timezone?: unknown } = {}): Promise<DemoStart> {
    const timezone = validTimezone(options.timezone) ?? 'UTC';
    const rawToken = 'demo.' + randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const schema = 'demo_' + randomBytes(12).toString('hex');
    const reserved = await this.locked(async client => {
      const counts = (await client.query(`SELECT
        COUNT(*) FILTER (WHERE expires_at > NOW()) AS live,
        COUNT(*) FILTER (WHERE created_at > NOW() - make_interval(mins => $1)) AS recent
        FROM projectops_demo_sandboxes`, [this.limits.windowMinutes])).rows[0];
      if (Number(counts.live) >= this.limits.maxLive || Number(counts.recent) >= this.limits.maxPerWindow) return null;
      // The row exists before the schema does, so the sweeper never mistakes a sandbox being
      // built for an orphan; a build that dies leaves a 'creating' row the sweeper removes.
      return (await client.query(`INSERT INTO projectops_demo_sandboxes (token_hash, schema_name, csrf_token, timezone, expires_at)
        VALUES ($1, $2, $3, $4, NOW() + make_interval(mins => $5)) RETURNING expires_at`,
        [hash(rawToken), schema, csrfToken, timezone, this.limits.lifetimeMinutes])).rows[0];
    });
    if (!reserved) return 'busy';
    try {
      await this.build(schema);
      await this.pool.query("UPDATE projectops_demo_sandboxes SET status = 'ready' WHERE token_hash = $1", [hash(rawToken)]);
    } catch (error) {
      await this.dropSchema(schema).catch(() => {});
      await this.pool.query('DELETE FROM projectops_demo_sandboxes WHERE token_hash = $1', [hash(rawToken)]).catch(() => {});
      throw error;
    }
    return { rawToken, csrfToken, expiresAtIso: new Date(reserved.expires_at).toISOString() };
  }

  async resolve(rawToken: string | undefined): Promise<DemoSession | null> {
    if (!rawToken || !DEMO_TOKEN.test(rawToken)) return null;
    const tokenHash = hash(rawToken);
    const row = (await this.pool.query(`SELECT schema_name, csrf_token, default_currency, default_priority, timezone, expires_at
      FROM projectops_demo_sandboxes WHERE token_hash = $1 AND status = 'ready' AND expires_at > NOW()`, [tokenHash])).rows[0];
    if (!row || !SCHEMA.test(row.schema_name)) return null;
    return {
      login: DEMO_LOGIN, csrfToken: row.csrf_token, tokenHash,
      defaults: { defaultCurrency: row.default_currency, defaultPriority: row.default_priority, timezone: row.timezone },
      demo: { schema: row.schema_name, expiresAtIso: new Date(row.expires_at).toISOString() },
    };
  }

  async saveDefaults(session: DemoSession, value: unknown): Promise<OperatorDefaults> {
    const v = validateOperatorDefaults(value);
    await this.pool.query(`UPDATE projectops_demo_sandboxes SET default_currency = $1, default_priority = $2, timezone = $3
      WHERE token_hash = $4`, [v.defaultCurrency, v.defaultPriority, v.timezone, session.tokenHash]);
    return v;
  }

  /**
   * Replace the sandbox's data with a fresh seed. The new schema is built first and swapped in
   * one statement, so the visitor never sees a half-built sandbox. The expiry does not move.
   * 'busy' when the previous reset was too recent.
   */
  async reset(session: DemoSession): Promise<'reset' | 'busy'> {
    const allowed = (await this.pool.query(`SELECT 1 FROM projectops_demo_sandboxes WHERE token_hash = $1
      AND (reset_at IS NULL OR reset_at < NOW() - make_interval(secs => $2))`, [session.tokenHash, this.limits.resetCooldownSeconds])).rows.length > 0;
    if (!allowed) return 'busy';
    const next = 'demo_' + randomBytes(12).toString('hex');
    // Recorded as building under its own row first, so a crash mid-build leaves nothing unaccounted for.
    const placeholder = 'reset.' + randomBytes(32).toString('base64url');
    await this.pool.query(`INSERT INTO projectops_demo_sandboxes (token_hash, schema_name, csrf_token, expires_at)
      VALUES ($1, $2, '', NOW() + INTERVAL '10 minutes')`, [hash(placeholder), next]);
    try {
      await this.build(next);
      const previous = await this.locked(async client => {
        const old = (await client.query('SELECT schema_name FROM projectops_demo_sandboxes WHERE token_hash = $1', [session.tokenHash])).rows[0];
        if (!old) return null;
        await client.query('DELETE FROM projectops_demo_sandboxes WHERE token_hash = $1', [hash(placeholder)]);
        await client.query('UPDATE projectops_demo_sandboxes SET schema_name = $1, reset_at = NOW() WHERE token_hash = $2', [next, session.tokenHash]);
        return old.schema_name as string;
      });
      if (!previous) throw new Error('Demo sandbox ended during reset.');
      await this.dropSchema(previous);
      return 'reset';
    } catch (error) {
      await this.dropSchema(next).catch(() => {});
      await this.pool.query('DELETE FROM projectops_demo_sandboxes WHERE token_hash = $1', [hash(placeholder)]).catch(() => {});
      throw error;
    }
  }

  /**
   * Leave the demo: the visitor's data is deleted now rather than at expiry. The row stays, expired,
   * until it leaves the rate window, so leaving and starting again still counts against the limit.
   */
  async end(session: DemoSession): Promise<void> {
    const row = (await this.pool.query(`UPDATE projectops_demo_sandboxes SET expires_at = LEAST(expires_at, NOW())
      WHERE token_hash = $1 RETURNING schema_name`, [session.tokenHash])).rows[0];
    if (row) await this.dropSchema(row.schema_name);
  }

  /**
   * Drop expired sandboxes, builds that never finished, and any demo schema without a row (left
   * by a crash between a drop and a delete). Returns the schemas dropped.
   */
  async sweep(): Promise<string[]> {
    // Schemas to drop: those of expired sandboxes and unfinished builds, and demo schemas no row knows.
    const doomed = (await this.pool.query(`SELECT n.nspname FROM pg_namespace n
      LEFT JOIN projectops_demo_sandboxes s ON s.schema_name = n.nspname
      WHERE n.nspname ~ '^demo_[a-f0-9]{24}$'
        AND (s.schema_name IS NULL OR s.expires_at <= NOW() OR (s.status = 'creating' AND s.created_at < NOW() - INTERVAL '10 minutes'))`))
      .rows.map(row => row.nspname as string);
    for (const schema of doomed) await this.dropSchema(schema);
    // Rows go once they no longer count towards the rate window (and builds that never finished).
    await this.pool.query(`DELETE FROM projectops_demo_sandboxes
      WHERE (expires_at <= NOW() AND created_at < NOW() - make_interval(mins => $1))
        OR (status = 'creating' AND created_at < NOW() - INTERVAL '10 minutes')`, [this.limits.windowMinutes]);
    return doomed;
  }

  private async build(schema: string): Promise<void> {
    if (!SCHEMA.test(schema)) throw new Error('Invalid demo sandbox schema.');
    // A dedicated connection: its search_path is changed for the whole session, and it is closed
    // afterwards rather than returned to the pool.
    const client = await this.openBuildClient();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await migrateProjectOpsPostgres(client, this.migrations);
      const connection: ProjectOpsQueryConnection = {
        async query<T>(sql: string, params: readonly unknown[] = []) {
          const result = await client.query(sql, [...params]) as Rows & { rowCount?: number | null; command?: string };
          return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command ?? '' };
        },
      };
      await client.query('BEGIN');
      try {
        await seedDemoAgency(new ProjectOpsConnectionSqlExecutor(connection, true), this.now());
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    } finally { await client.end(); }
  }

  private async dropSchema(schema: string): Promise<void> {
    // Validated: the name is interpolated, and only demo schemas may ever be dropped.
    if (!SCHEMA.test(schema)) throw new Error('Invalid demo sandbox schema.');
    await this.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }

  private async locked<T>(run: (client: DemoPoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query('SELECT pg_advisory_xact_lock(734102, 3)');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
}
