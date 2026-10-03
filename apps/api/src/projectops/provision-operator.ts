import { Pool } from 'pg';
import { ProjectOpsOperatorStore } from '../../../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../../../packages/projectops/src/postgres-migrations.ts';
import { readProjectOpsRuntimeConfig } from './postgres-app.ts';

// Credentials arrive on stdin, never argv or log output. This command only creates;
// it cannot overwrite an existing operator or bypass credential confirmation.
let pool: Pool | undefined;
try {
  const config = readProjectOpsRuntimeConfig();
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 4096) throw new Error('Provisioning input is too large.');
  }
  const credentials = JSON.parse(input);
  pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const client = await pool.connect();
  try { await migrateProjectOpsPostgres(client, await loadProjectOpsPostgresMigrations()); }
  finally { client.release(); }
  await new ProjectOpsOperatorStore(pool).provision(credentials.login, credentials.password);
  console.log('ProjectOps operator created.');
} catch {
  console.error('Could not create operator. Check database configuration, JSON input and credentials; an existing operator cannot be overwritten.');
  process.exitCode = 1;
} finally { await pool?.end(); }
