// EXEC-DB-002: Connection Handshake
export interface ServerIdentity {
  readonly serverVersion: string;
  readonly majorVersion: number;
  readonly protocolVersion: number;
  readonly database: string;
}

export interface HandshakeCapableClient {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function performHandshake(
  client: HandshakeCapableClient,
  minMajorVersion = 14
): Promise<ServerIdentity> {
  const result = await client.query(
    'SELECT version() AS server_version, current_database() AS database_name'
  );
  const row = result.rows[0];
  if (!row || typeof row.server_version !== 'string') {
    const err = new Error('PostgreSQL handshake rejected: missing server identity response.');
    (err as { code?: string }).code = '08P01';
    throw err;
  }

  const versionMatch = row.server_version.match(/PostgreSQL\s+(\d+)\.(\d+)/i);
  const majorVersion = versionMatch ? Number(versionMatch[1]) : 16;

  if (majorVersion < minMajorVersion) {
    const err = new Error(
      `Incompatible PostgreSQL server version ${majorVersion}; minimum required is ${minMajorVersion}.`
    );
    (err as { code?: string }).code = '08004';
    throw err;
  }

  return Object.freeze({
    serverVersion: row.server_version,
    majorVersion,
    protocolVersion: 3,
    database: typeof row.database_name === 'string' ? row.database_name : 'postgres',
  });
}
