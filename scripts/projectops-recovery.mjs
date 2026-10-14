import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, lstat, readFile, writeFile, open, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadProjectOpsPostgresMigrations } from '../packages/projectops/src/postgres-migrations.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const safeName = value => { if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value)) throw Error('An explicit safe service/source identity is required.'); return value; };
export function validateRestoreDatabase(value) {
  if (typeof value !== 'string' || !/^projectops_restore_[a-f0-9]{32}$/.test(value)) throw Error('A uniquely identified disposable restore database is required.');
  return value;
}
export const newRestoreDatabaseName = () => 'projectops_restore_' + randomUUID().replaceAll('-', '');
export async function privateLibpqEnvironment(env = process.env) {
  const serviceFile = env.PGSERVICEFILE;
  if (!serviceFile || !path.isAbsolute(serviceFile)) throw Error('An explicit private PGSERVICEFILE is required.');
  for (const file of [serviceFile, env.PGPASSFILE].filter(Boolean)) {
    if (!path.isAbsolute(file)) throw Error('Libpq configuration paths must be explicit and absolute.');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw Error('Libpq configuration must be a private regular file.');
  }
  return { ...env, PGSERVICEFILE: serviceFile };
}
async function serviceConnection(service, env, database) {
  safeName(service);
  const contents = await readFile(env.PGSERVICEFILE, 'utf8');
  let selected = false, sections = 0, fields = {};
  for (const line of contents.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) { selected = section[1] === service; if (selected && ++sections > 1) throw Error('Service configuration must be unambiguous.'); continue; }
    const pair = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (selected && pair) { if (Object.hasOwn(fields,pair[1])) throw Error('Service configuration must be unambiguous.'); fields[pair[1]] = pair[2]; }
  }
  if (!fields.host || !fields.dbname || !fields.user) throw Error('Service must explicitly identify host, database and user.');
  return 'service=' + service + (database ? ' dbname=' + validateRestoreDatabase(database) : '');
}
async function run(tool, args, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(tool, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => output += chunk);
    child.stderr.resume(); // Never forward credential/configuration or private SQL errors to logs.
    child.once('error', () => reject(Error('Required PostgreSQL recovery tool is unavailable.')));
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(Error('PostgreSQL recovery command failed.')));
  });
}
async function query(connection, sql, env) { return JSON.parse(await run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--dbname=' + connection, '--command=' + sql], env)); }
async function identity(connection, env) { return await query(connection, "SELECT jsonb_build_object('database',current_database(),'address',inet_server_addr(),'port',inet_server_port())", env); }
export async function databaseFingerprint(connection, env) {
  const tables = await query(connection, "SELECT COALESCE(jsonb_agg(jsonb_build_object('schema',schemaname,'name',tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE tablename LIKE 'projectops\\_%' ESCAPE '\\'", env);
  if (tables.length !== 19 || new Set(tables.map(t => t.schema)).size !== 1) throw Error('A complete unambiguous ProjectOps database is required.');
  const records = {}, quote = text => '"' + text.replaceAll('"', '""') + '"';
  for (const table of tables) {
    const rows = await query(connection, `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM ${quote(table.schema)}.${quote(table.name)} t`, env);
    records[table.name] = hash(JSON.stringify(rows));
  }
  const schema = await query(connection, `SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='${tables[0].schema.replaceAll("'", "''")}' AND table_name LIKE 'projectops\\_%' ESCAPE '\\') c),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='${tables[0].schema.replaceAll("'", "''")}' AND r.relname LIKE 'projectops\\_%' ESCAPE '\\'),
    'indexes',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='${tables[0].schema.replaceAll("'", "''")}' AND tablename LIKE 'projectops\\_%' ESCAPE '\\'))`, env);
  const ledger = await query(connection, 'SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM (SELECT version,name,checksum FROM projectops_schema_migrations) t', env);
  const expected = (await loadProjectOpsPostgresMigrations()).map(m => ({ version: m.version, name: m.name, checksum: hash(m.upSql) }));
  if (JSON.stringify(ledger.map(r => [r.version,r.name,r.checksum])) !== JSON.stringify(expected.map(r => [r.version,r.name,r.checksum]))) throw Error('Migration ledger does not match frozen migrations 0001–0007.');
  const business = Object.fromEntries(Object.entries(records).filter(([name]) => !['projectops_operator_sessions','projectops_login_limit'].includes(name)));
  return { full: hash(JSON.stringify({ records, schema })), business: hash(JSON.stringify({ records: business, schema })), schema: hash(JSON.stringify(schema)), ledger: hash(JSON.stringify(ledger)) };
}
async function privateDestination(directory) {
  directory ??= path.join(tmpdir(), 'projectops-backups-' + randomUUID());
  let ancestor = path.resolve(directory);
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  let current = ancestor;
  while (true) {
    try {
      const marker = await lstat(path.join(current, '.git'));
      if (marker.isFile()) throw Error('Backups must be outside a source checkout.');
      // Some managed workspaces reserve an empty read-only .git sentinel outside repositories.
      if (marker.isDirectory()) { await lstat(path.join(current, '.git', 'HEAD')); throw Error('Backups must be outside a source checkout.'); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break; current = path.dirname(current);
  }
  await mkdir(directory, { mode: 0o700, recursive: true });
  const resolved = await realpath(directory), info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077)) throw Error('A private backup directory is required.');
  return resolved;
}
export async function backupProjectOps({ sourceService, sourceIdentity, directory, checkpoint, env: suppliedEnv = process.env }) {
  safeName(sourceIdentity);
  if (checkpoint !== undefined && !/^[a-f0-9]{40}$/.test(checkpoint)) throw Error('Invalid checkpoint.');
  const env = await privateLibpqEnvironment(suppliedEnv), connection = await serviceConnection(sourceService, env);
  const destination = await privateDestination(directory), archive = path.join(destination, 'projectops-backup-' + randomUUID() + '.dump');
  const before = await databaseFingerprint(connection, env), source = await identity(connection, env);
  const file = await open(archive, 'wx', 0o600); await file.close();
  try {
    const pgDumpVersion = await run('pg_dump', ['--version'], env), pgRestoreVersion = await run('pg_restore', ['--version'], env);
    const serverVersion = await query(connection, 'SELECT to_jsonb(current_setting(\'server_version\'))', env);
    await run('pg_dump', ['--dbname=' + connection, '--format=custom', '--file=' + archive], env);
    const content = await readFile(archive); if (!content.length) throw Error('Backup archive is empty.');
    const toc = await run('pg_restore', ['--list', archive], env); if (!toc.includes('projectops_schema_migrations')) throw Error('Archive is missing migration data.');
    if ((await databaseFingerprint(connection, env)).full !== before.full) throw Error('Source changed during backup; quiesce the acceptance source.');
    const receipt = { format: 'projectops.postgres-backup', version: 1, createdAtIso: new Date().toISOString(), sourceIdentity, ...(checkpoint ? { checkpoint } : {}), serverVersion, pgDumpVersion, pgRestoreVersion, bytes: content.length, sha256: hash(content), migrationLedgerDigest: before.ledger, sourceFingerprint: before.full, businessFingerprint: before.business, schemaFingerprint: before.schema };
    await writeFile(archive + '.receipt.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { archive, receipt, source }; // source is internal guard metadata, never printed in the receipt.
  } catch (error) { await unlink(archive).catch(() => {}); throw error; }
}
export async function restoreDisposableBackup({ sourceService, maintenanceService, targetDatabase, archive, env: suppliedEnv = process.env, verifyApplication }) {
  validateRestoreDatabase(targetDatabase);
  const env = await privateLibpqEnvironment(suppliedEnv), source = await serviceConnection(sourceService, env), maintenance = await serviceConnection(maintenanceService, env);
  const sourceId = await identity(source, env);
  if (sourceId.database === targetDatabase) throw Error('Restore target must differ from the source.');
  const info = await lstat(archive); if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw Error('A private backup archive is required.');
  const receipt = JSON.parse(await readFile(archive + '.receipt.json', 'utf8')), content = await readFile(archive);
  if (receipt.format !== 'projectops.postgres-backup' || receipt.version !== 1 || !content.length || content.length !== receipt.bytes || hash(content) !== receipt.sha256) throw Error('Backup integrity verification failed.');
  const before = await databaseFingerprint(source, env);
  if (before.full !== receipt.sourceFingerprint) throw Error('Source no longer matches the recorded backup baseline.');
  await run('pg_restore', ['--list', archive], env);
  const target = await serviceConnection(maintenanceService, env, targetDatabase);
  // CREATE must succeed: no adoption, clearing or deletion of an existing database is permitted.
  await run('psql', ['--no-psqlrc','--set=ON_ERROR_STOP=1','--dbname=' + maintenance,'--command=CREATE DATABASE "' + targetDatabase + '" TEMPLATE template0'], env);
  let restored;
  try {
    await run('pg_restore', ['--dbname=' + target,'--exit-on-error','--single-transaction','--no-owner','--no-acl', archive], env);
    restored = await databaseFingerprint(target, env);
    if (restored.full !== before.full || restored.ledger !== receipt.migrationLedgerDigest) throw Error('Restored schema/data does not match the backup baseline.');
    if (verifyApplication) await verifyApplication({ targetDatabase, connection: target });
    if ((await databaseFingerprint(target, env)).business !== before.business) throw Error('Restored application changed business data.');
    if ((await databaseFingerprint(source, env)).full !== before.full) throw Error('Source changed during the restore drill.');
    return { restored: true, applicationVerified: Boolean(verifyApplication), sourceUnchanged: true, schemaFingerprint: restored.schema, migrationLedgerDigest: restored.ledger };
  } finally {
    // This invocation created the database successfully. Never FORCE/drop arbitrary caller targets.
    await run('psql', ['--no-psqlrc','--set=ON_ERROR_STOP=1','--dbname=' + maintenance,'--command=DROP DATABASE "' + targetDatabase + '"'], env);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let input = ''; for await (const part of process.stdin) { input += part; if (input.length > 8192) throw Error('Input too large.'); }
    const config = JSON.parse(input);
    if (config.action === 'backup') { const result = await backupProjectOps(config); console.log(JSON.stringify({ archive: result.archive, receipt: result.receipt })); }
    else if (config.action === 'restore-drill') console.log(JSON.stringify(await restoreDisposableBackup(config)));
    else throw Error('Explicit backup or restore-drill action is required.');
  } catch { console.error('ProjectOps recovery failed. Check private profiles, archive integrity and disposable target permissions.'); process.exitCode = 1; }
}
