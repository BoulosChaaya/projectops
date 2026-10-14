import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Recovery acceptance owns whole databases; it never dumps/restores the configured shared test DB. */
export async function finalDatabaseFixture(run: (value: any) => Promise<void>) {
  const configured = process.env.PROJECTOPS_TEST_DATABASE_URL;
  if (!configured) throw Error('PROJECTOPS_TEST_DATABASE_URL is required.');
  const maintenance = new URL(configured), database = 'projectops_acceptance_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: configured });
  const directory = await mkdtemp(path.join(tmpdir(),'projectops-final-'));
  let created = false;
  try {
    await admin.query('CREATE DATABASE "' + database + '" TEMPLATE template0'); created = true;
    const source = new URL(configured); source.pathname = '/' + database; source.searchParams.delete('options');
    const value = (text: string) => { if (/[\r\n]/.test(text)) throw Error('Invalid libpq fixture configuration.'); return text; };
    const common = `host=${value(maintenance.hostname)}\nport=${value(maintenance.port||'5432')}\nuser=${value(decodeURIComponent(maintenance.username))}\n`;
    const ssl = maintenance.searchParams.get('sslmode');
    const config = common + (ssl ? `sslmode=${value(ssl)}\n` : '');
    const serviceFile=path.join(directory,'services'),passFile=path.join(directory,'passfile');
    await writeFile(serviceFile,`[source]\n${config}dbname=${database}\n[maintenance]\n${config}dbname=${value(maintenance.pathname.slice(1))}\n`,{mode:0o600});
    const escape=(s:string)=>s.replaceAll('\\','\\\\').replaceAll(':','\\:');
    await writeFile(passFile,[maintenance.hostname,maintenance.port||'5432','*',decodeURIComponent(maintenance.username),decodeURIComponent(maintenance.password)].map(escape).join(':')+'\n',{mode:0o600});
    const env={...process.env,PGSERVICEFILE:serviceFile,PGPASSFILE:passFile};
    const pool=new Pool({connectionString:source.toString()});
    try { await run({ databaseUrl:source.toString(),pool,admin,directory,env,targetUrl:(name:string)=>{const url=new URL(source);url.pathname='/'+name;return url.toString();} }); }
    finally { await pool.end(); }
  } finally {
    if(created)await admin.query('DROP DATABASE "'+database+'"');
    await admin.end(); await rm(directory,{recursive:true,force:true});
  }
}
