import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../auth/src/password/index.ts';

export interface OperatorConnection {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}
export interface OperatorPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  connect(): Promise<OperatorConnection>;
}
export interface OperatorDefaults {
  defaultCurrency: string;
  defaultPriority: 'low' | 'medium' | 'high';
  timezone: string;
}
export interface OperatorSession {
  login: string;
  csrfToken: string;
  tokenHash: string;
  defaults: OperatorDefaults;
}
const dummyHash = hashPassword(randomBytes(32).toString('hex'));
export const SESSION_SECONDS = 8 * 60 * 60;
export const hashOperatorToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function validateOperatorLogin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Login must contain 3-120 letters, numbers or . _ @ -');
  const login = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.@-]{2,119}$/.test(login)) throw new Error('Login must contain 3-120 letters, numbers or . _ @ -');
  return login;
}
export function validateOperatorPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 512) {
    throw new Error('Password must contain 12-512 characters.');
  }
  return value;
}
export function validateOperatorDefaults(value: unknown): OperatorDefaults {
  const v = value as Partial<OperatorDefaults> | null;
  if (!v || typeof v !== 'object' || typeof v.defaultCurrency !== 'string' || !/^[A-Z]{3}$/.test(v.defaultCurrency)) {
    throw new Error('Default currency must be a three-letter uppercase code.');
  }
  if (!['low', 'medium', 'high'].includes(v.defaultPriority!)) throw new Error('Invalid default priority.');
  if (typeof v.timezone !== 'string' || v.timezone.length > 100) throw new Error('Invalid timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: v.timezone }); } catch { throw new Error('Invalid timezone.'); }
  return { defaultCurrency: v.defaultCurrency, defaultPriority: v.defaultPriority!, timezone: v.timezone };
}
function defaults(row: any): OperatorDefaults {
  return { defaultCurrency: row.default_currency, defaultPriority: row.default_priority, timezone: row.timezone };
}

export class ProjectOpsOperatorStore {
  private readonly pool: OperatorPool;
  constructor(pool: OperatorPool) { this.pool = pool; }

  private async transaction<T>(run: (client: OperatorConnection) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes login issuance with password changes and session revocation.
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query('SELECT pg_advisory_xact_lock(734102, 2)');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async provision(loginInput: unknown, passwordInput: unknown): Promise<void> {
    const login = validateOperatorLogin(loginInput);
    const encoded = hashPassword(validateOperatorPassword(passwordInput));
    await this.pool.query('INSERT INTO projectops_operator (id, login, password_hash) VALUES (1, $1, $2)', [login, encoded]);
  }

  private async takeAttempt(client: OperatorConnection): Promise<boolean> {
    const result = await client.query(`UPDATE projectops_login_limit SET
      attempts = CASE WHEN window_start <= NOW() - INTERVAL '1 minute' THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start <= NOW() - INTERVAL '1 minute' THEN NOW() ELSE window_start END
      WHERE id = 1 RETURNING attempts`);
    return Number(result.rows[0]?.attempts) <= 10;
  }

  async login(login: string, password: string): Promise<
    { rawToken: string; csrfToken: string } | 'limited' | null
  > {
    return await this.transaction(async client => {
      if (!await this.takeAttempt(client)) return 'limited';
      const row = (await client.query('SELECT * FROM projectops_operator WHERE id = 1')).rows[0];
      const matches = verifyPassword(password, row?.password_hash ?? dummyHash);
      if (!row || row.login !== login.trim().toLowerCase() || !matches) return null;
      await client.query(`DELETE FROM projectops_operator_sessions
        WHERE expires_at <= NOW() OR last_seen_at <= NOW() - INTERVAL '30 minutes'`);
      const rawToken = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      await client.query(`INSERT INTO projectops_operator_sessions
        (token_hash, operator_id, csrf_token, expires_at) VALUES ($1, 1, $2, NOW() + INTERVAL '8 hours')`,
        [hashOperatorToken(rawToken), csrfToken]);
      return { rawToken, csrfToken };
    });
  }

  async resolve(rawToken: string | undefined): Promise<OperatorSession | null> {
    if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const tokenHash = hashOperatorToken(rawToken);
    const row = (await this.pool.query(`UPDATE projectops_operator_sessions s SET last_seen_at = NOW()
      FROM projectops_operator o WHERE s.operator_id = o.id AND s.token_hash = $1
      AND s.expires_at > NOW() AND s.last_seen_at > NOW() - INTERVAL '30 minutes'
      RETURNING o.login, o.default_currency, o.default_priority, o.timezone, s.csrf_token`, [tokenHash])).rows[0];
    return row ? { login: row.login, csrfToken: row.csrf_token, tokenHash, defaults: defaults(row) } : null;
  }

  async logout(session: OperatorSession): Promise<void> {
    await this.transaction(async client => {
      await client.query('DELETE FROM projectops_operator_sessions WHERE token_hash = $1', [session.tokenHash]);
    });
  }

  async saveDefaults(value: unknown): Promise<OperatorDefaults> {
    const v = validateOperatorDefaults(value);
    await this.pool.query(`UPDATE projectops_operator SET default_currency = $1, default_priority = $2,
      timezone = $3, updated_at = NOW() WHERE id = 1`, [v.defaultCurrency, v.defaultPriority, v.timezone]);
    return v;
  }

  async changeCredentials(currentPassword: string, newLogin: unknown, newPassword: unknown): Promise<boolean | 'limited'> {
    const login = validateOperatorLogin(newLogin);
    const password = validateOperatorPassword(newPassword);
    return await this.transaction(async client => {
      if (!await this.takeAttempt(client)) return 'limited';
      const row = (await client.query('SELECT password_hash FROM projectops_operator WHERE id = 1')).rows[0];
      if (!row || !verifyPassword(currentPassword, row.password_hash)) return false;
      await client.query('UPDATE projectops_operator SET login = $1, password_hash = $2, updated_at = NOW() WHERE id = 1',
        [login, hashPassword(password)]);
      await client.query('DELETE FROM projectops_operator_sessions');
      return true;
    });
  }
}
