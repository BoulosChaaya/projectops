import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

export async function operatorFixture(run: (url: string, pool: Pool) => Promise<void>) {
  const databaseUrl = process.env.PROJECTOPS_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('PROJECTOPS_TEST_DATABASE_URL is required.');
  const schema = `operator_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.toString() });
  try { await run(url.toString(), pool); }
  finally { await pool.end(); try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); } }
}

