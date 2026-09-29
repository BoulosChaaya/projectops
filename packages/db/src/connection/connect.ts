// EXEC-DB-001: Database Connection Establishment
import { performHandshake, type ServerIdentity } from './handshake.ts';
import { withConnectDeadline } from './timeout.ts';

const URL_SSL_PARAMS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation'];

export interface RawQueryResult<TRow = Record<string, unknown>> {
  readonly rows: TRow[];
  readonly rowCount: number;
  readonly command: string;
}

export interface DatabaseConnection {
  readonly id: string;
  readonly identity: ServerIdentity;
  isOpen(): boolean;
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<RawQueryResult<TRow>>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  readonly connectionString?: string;
  readonly host?: string;
  readonly port?: number;
  readonly database?: string;
  readonly user?: string;
  readonly password?: string;
  readonly ssl?: { readonly mode: 'disable' | 'require' | 'verify-full' };
  readonly connectTimeoutMs?: number;
  readonly minMajorVersion?: number;
  readonly driverFactory?: () => Promise<DriverSocketConnection>;
}

export interface DriverSocketConnection {
  readonly id: string;
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<RawQueryResult<TRow>>;
  close(): Promise<void>;
  isOpen(): boolean;
}

export function validateDatabaseConfig(config: DatabaseConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('DatabaseConfig must be an object.');
  }
  if (config.connectionString) {
    let parsed: URL;
    try {
      parsed = new URL(config.connectionString);
    } catch {
      throw new Error('Invalid PostgreSQL connectionString URL format.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('connectionString must use postgres:// or postgresql:// protocol.');
    }
    if (config.ssl !== undefined) {
      const keys = Array.from(parsed.searchParams.keys()).map((k) => k.toLowerCase());
      if (URL_SSL_PARAMS.some((p) => keys.includes(p))) {
        throw new Error('Ambiguous SSL configuration: URL SSL parameters cannot be mixed with ssl object.');
      }
    }
  } else if (!config.host || !config.database || !config.user) {
    throw new Error('DatabaseConfig requires either connectionString or discrete host, database, and user.');
  }
}

export async function connectDatabase(config: DatabaseConfig): Promise<DatabaseConnection> {
  validateDatabaseConfig(config);
  const timeoutMs = config.connectTimeoutMs ?? 5000;
  let pendingRawConn: DriverSocketConnection | undefined;

  return await withConnectDeadline(
    timeoutMs,
    async (signal) => {
      if (!config.driverFactory) {
        throw new Error('driverFactory is required when no external pg socket is injected.');
      }
      const raw = await config.driverFactory();
      pendingRawConn = raw;

      if (signal.aborted) {
        await raw.close();
        throw new Error('Connection aborted due to timeout deadline.');
      }

      const identity = await performHandshake(raw, config.minMajorVersion ?? 14);

      return Object.freeze({
        id: raw.id,
        identity,
        isOpen: () => raw.isOpen(),
        query: <TRow = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) =>
          raw.query<TRow>(sql, params),
        close: () => raw.close(),
      });
    },
    async () => {
      if (pendingRawConn && pendingRawConn.isOpen()) {
        await pendingRawConn.close();
      }
    }
  );
}
