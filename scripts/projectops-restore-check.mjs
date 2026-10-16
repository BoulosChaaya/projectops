import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadProjectOpsPostgresMigrations } from '../packages/projectops/src/postgres-migrations.ts';

// Checks a database restored by Render's point-in-time recovery before anyone relies on it.
// Run from the web service's Shell, where DATABASE_URL is the live database:
//   RESTORE_DATABASE_URL='<internal URL of the restored database>' node --experimental-strip-types scripts/projectops-restore-check.mjs
// It only reads. It prints row counts side by side and the newest history entry in each, never a
// connection string or a row's contents, and passes only if the restored database is a different
// database holding a complete ProjectOps schema whose migrations match this code.

const hash = value => createHash('sha256').update(value).digest('hex');
// Visitors' demo registry and the owner's sessions and sign-in counter are not business data.
const NOT_COMPARED = new Set(['projectops_demo_sandboxes', 'projectops_operator_sessions', 'projectops_login_limit']);

async function inspect(connectionString, label) {
  const client = new pg.Client({ connectionString });
  try { await client.connect(); } catch { throw Error(`Could not connect to the ${label} database.`); }
  try {
    const where = (await client.query(`SELECT current_database() AS database, current_schema() AS schema,
      COALESCE(host(inet_server_addr()), 'local') AS address, COALESCE(inet_server_port(), 0) AS port`)).rows[0];
    const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
      AND tablename LIKE 'projectops\\_%' ESCAPE '\\' ORDER BY tablename`)).rows.map(row => row.tablename);
    const counts = {};
    for (const table of tables) counts[table] = Number((await client.query(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`)).rows[0].n);
    const ledger = tables.includes('projectops_schema_migrations')
      ? (await client.query('SELECT version, name, checksum FROM projectops_schema_migrations ORDER BY version')).rows : [];
    const newest = tables.includes('projectops_project_activities')
      ? (await client.query('SELECT max(happened_at) AS at FROM projectops_project_activities')).rows[0].at : null;
    return { where, tables, counts, ledger, newestActivity: newest ? new Date(newest).toISOString() : null };
  } finally { await client.end(); }
}

export async function checkRestore({ liveUrl, restoredUrl }) {
  if (!liveUrl) throw Error('DATABASE_URL is not set: run this from the web service Shell.');
  if (!restoredUrl) throw Error('RESTORE_DATABASE_URL is not set: use the restored database\'s internal URL.');
  if (liveUrl === restoredUrl) throw Error('RESTORE_DATABASE_URL is the live database, not the restored one.');
  const [live, restored] = [await inspect(liveUrl, 'live'), await inspect(restoredUrl, 'restored')];
  const same = ['database', 'schema', 'address', 'port'].every(key => String(live.where[key]) === String(restored.where[key]));
  if (same) throw Error('RESTORE_DATABASE_URL reaches the live database, not the restored one.');

  const expected = (await loadProjectOpsPostgresMigrations()).map(m => [m.version, m.name, hash(m.upSql)].join(' '));
  const problems = [];
  const ledger = restored.ledger.map(row => [row.version, row.name, row.checksum].join(' '));
  if (JSON.stringify(ledger) !== JSON.stringify(expected)) problems.push(`migrations: restored has ${ledger.length}, this code has ${expected.length} (or they differ)`);
  const missing = live.tables.filter(table => !restored.tables.includes(table));
  if (missing.length) problems.push(`tables missing from the restored database: ${missing.join(', ')}`);
  if (!restored.counts.projectops_clients) problems.push('the restored database has no clients');

  const rows = live.tables.filter(table => !NOT_COMPARED.has(table))
    .map(table => ({ table: table.replace(/^projectops_/, ''), live: live.counts[table], restored: restored.counts[table] ?? 'missing' }));
  return { ok: problems.length === 0, problems, rows, newestActivity: { live: live.newestActivity, restored: restored.newestActivity } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await checkRestore({ liveUrl: process.env.DATABASE_URL, restoredUrl: process.env.RESTORE_DATABASE_URL });
    const width = Math.max(...report.rows.map(row => row.table.length));
    console.log(`${'table'.padEnd(width)}  live  restored`);
    for (const row of report.rows) console.log(`${row.table.padEnd(width)}  ${String(row.live).padStart(4)}  ${String(row.restored).padStart(8)}`);
    console.log(`newest history entry: live ${report.newestActivity.live ?? 'none'}, restored ${report.newestActivity.restored ?? 'none'}`);
    if (report.ok) console.log('PASS: the restored database is complete, and its migrations match this code.');
    else { for (const problem of report.problems) console.error('FAIL: ' + problem); process.exitCode = 1; }
  } catch (error) {
    console.error('FAIL: ' + (error instanceof Error ? error.message : 'unknown error'));
    process.exitCode = 1;
  }
}
