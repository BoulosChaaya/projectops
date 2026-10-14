import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { finalDatabaseFixture } from './final-fixture.ts';
import { backupProjectOps, restoreDisposableBackup, newRestoreDatabaseName, databaseFingerprint } from '../../scripts/projectops-recovery.mjs';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { ProjectOpsRepository, ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection } from '../../packages/projectops/src/index.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { seedExport, assertExport, AUDIT } from '../export-fixture.ts';

test('Real custom-format database backup restores source/settings/relationships/history/exact money and application into a different owned database',async()=>{
  await finalDatabaseFixture(async f=>{
    const client=await f.pool.connect();try{await migrateProjectOpsPostgres(client,await loadProjectOpsPostgresMigrations());}finally{client.release();}
    const secret=randomBytes(24).toString('base64url');await new ProjectOpsOperatorStore(f.pool).provision('operator',secret);
    await new ProjectOpsOperatorStore(f.pool).saveDefaults({defaultCurrency:'GBP',defaultPriority:'high',timezone:'Asia/Beirut'});
    const repo=new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(f.pool))).withHistory({actor:'operator',clock:()=>AUDIT});await repo.createClient({id:'c',name:'Recovery client',createdAtIso:'2026-10-01T00:00:00.000Z'});await seedExport(repo,'delivered','delivered');
    const before=await databaseFingerprint('service=source',f.env);
    const backup=await backupProjectOps({sourceService:'source',sourceIdentity:'acceptance-source',directory:path.join(f.directory,'backups'),env:f.env});
    assert.ok(backup.receipt.bytes>0);assert.equal(backup.receipt.migrationLedgerDigest,before.ledger);assert.equal((await stat(backup.archive)).mode&0o077,0);
    const text=await readFile(backup.archive+'.receipt.json','utf8');for(const excluded of [secret,'password_hash','csrf_token','postgresql://','INTERNAL-BRIEF'])assert.ok(!text.includes(excluded));
    const target=newRestoreDatabaseName();
    const restored=await restoreDisposableBackup({sourceService:'source',maintenanceService:'maintenance',targetDatabase:target,archive:backup.archive,env:f.env,verifyApplication:async()=>{
      const app=await startProjectOpsPostgresApp({databaseUrl:f.targetUrl(target),host:'127.0.0.1',port:0});
      try{
        const origin=app.server.origin;
        const login=await fetch(origin+'/projectops/access/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({login:'operator',password:secret})});assert.equal(login.status,200);
        const headers={cookie:login.headers.get('set-cookie')!.split(';')[0]};const session=await fetch(origin+'/projectops/access/session',{headers}).then(r=>r.json());assert.equal(session.defaults.timezone,'Asia/Beirut');
        assert.equal((await fetch(origin+'/health/ready')).status,200);
        const root='/projectops/project-requests/delivered';const artifact=await fetch(origin+root+'/export',{headers}).then(r=>r.json());assertExport(artifact,'delivered');assert.equal(artifact.collections.activities.length,(await repo.listProjectActivities('delivered')).length);
        for(const section of ['invoices','expenses','activities','tasks','deliverables'])assert.ok((await fetch(origin+root+'/'+section,{headers}).then(r=>r.json())).length>0);
        const workspace=await fetch(origin+'/projectops/projects/delivered',{headers});assert.equal(workspace.status,200);assert.match(await workspace.text(),/Project workspace/);
        const handoff=await fetch(origin+'/projectops/projects/delivered/delivery-summary',{headers});assert.equal(handoff.status,200);assert.doesNotMatch(await handoff.text(),/INTERNAL-BRIEF/);
      }finally{await app.close();}
    }});
    assert.deepEqual(restored,{restored:true,applicationVerified:true,sourceUnchanged:true,schemaFingerprint:before.schema,migrationLedgerDigest:before.ledger});
    assert.equal((await f.admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[target])).rows.length,0);
    assert.deepEqual(await databaseFingerprint('service=source',f.env),before);
    // Existing even empty targets cannot be adopted/deleted. Corruption and source identity fail before writes.
    const existing=newRestoreDatabaseName();await f.admin.query('CREATE DATABASE "'+existing+'" TEMPLATE template0');
    try{
      await assert.rejects(()=>restoreDisposableBackup({sourceService:'source',maintenanceService:'maintenance',targetDatabase:existing,archive:backup.archive,env:f.env}));assert.equal((await f.admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[existing])).rows.length,1);
      const profiles=await readFile(f.env.PGSERVICEFILE,'utf8'),same=profiles.match(/\[source\]([\s\S]*?)\[maintenance\]/)![1].replace(/^dbname=.*$/m,'dbname='+existing);
      await writeFile(f.env.PGSERVICEFILE,profiles+'\n[same-source]'+same);
      await assert.rejects(()=>restoreDisposableBackup({sourceService:'same-source',maintenanceService:'maintenance',targetDatabase:existing,archive:backup.archive,env:f.env}),/differ/);assert.equal((await f.admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[existing])).rows.length,1);
    }finally{await f.admin.query('DROP DATABASE "'+existing+'"');}
    const original=await readFile(backup.archive);await writeFile(backup.archive,Buffer.concat([original,Buffer.from('corrupt')]));
    const rejected=newRestoreDatabaseName();await assert.rejects(()=>restoreDisposableBackup({sourceService:'source',maintenanceService:'maintenance',targetDatabase:rejected,archive:backup.archive,env:f.env}),/integrity/);assert.equal((await f.admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[rejected])).rows.length,0);await writeFile(backup.archive,original);
    const failed=newRestoreDatabaseName();
    await assert.rejects(()=>restoreDisposableBackup({sourceService:'source',maintenanceService:'maintenance',targetDatabase:failed,archive:backup.archive,env:f.env,verifyApplication:async()=>{throw Error('Injected verification failure');}}),/Injected/);
    assert.equal((await f.admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[failed])).rows.length,0);
    await access(backup.archive);assert.deepEqual(await databaseFingerprint('service=source',f.env),before);
  });
});
