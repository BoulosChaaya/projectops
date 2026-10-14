import { Pool } from 'pg';
import { ProjectOpsOperatorStore } from '../../../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../../../packages/projectops/src/postgres-migrations.ts';
import { readProjectOpsDatabaseUrl } from './postgres-app.ts';

// Credentials arrive on stdin, never argv or log output. This command only creates;
// it cannot overwrite an existing operator or bypass credential confirmation. It needs only
// DATABASE_URL: it serves no HTTP, so it must not require the web service's HOST/PUBLIC_ORIGIN
// settings (a Render Shell has HOST=0.0.0.0 but no PUBLIC_ORIGIN, which the start wrapper derives).
let pool: Pool | undefined;
try {
  const databaseUrl = readProjectOpsDatabaseUrl();
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 4096) throw new Error('Provisioning input is too large.');
  }
  const credentials = JSON.parse(input);
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const client = await pool.connect();
  try { await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations()); }
  finally { client.release(); }
  await new ProjectOpsOperatorStore(pool).provision(credentials.login, credentials.password);
  console.log('ProjectOps operator created.');
} catch {
  console.error('Could not create operator. Check database configuration, JSON input and credentials; an existing operator cannot be overwritten.');
  process.exitCode = 1;
} finally { await pool?.end(); }
