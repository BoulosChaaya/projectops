import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm, readFile, symlink, access as fileAccess } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectOpsMemorySqlExecutor } from '../packages/projectops/src/index.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../apps/api/src/projectops/access.ts';
import { validateRestoreDatabase, privateLibpqEnvironment, newRestoreDatabaseName, backupProjectOps } from '../scripts/projectops-recovery.mjs';
import { validateDeployedSmoke } from '../scripts/projectops-deployed-smoke.mjs';
import { createRuntimeRelease } from '../scripts/projectops-release.mjs';

test('Private response policy covers Origin/JSON/CSRF, business and early parser errors without changing failure semantics', async () => {
  const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('hex');
  const session = {login:'operator',csrfToken:csrf,tokenHash:'fixture',defaults:{defaultCurrency:'EUR',defaultPriority:'medium' as const,timezone:'UTC'}};
  let failAuth=false;
  const access = new ProjectOpsAccess({resolve:async t=>{if(failAuth)throw Error('Injected internal failure');return t===token?session:null;},login:async()=>null,logout:async()=>{},saveDefaults:async()=>session.defaults,changeCredentials:async()=>false});
  const app=await startProjectOpsApp({sql:new ProjectOpsMemorySqlExecutor(),access,host:'127.0.0.1',port:0});
  try {
    const origin=app.server.origin, headers={origin,'content-type':'application/json',cookie:'projectops_session='+token,'x-csrf-token':csrf};
    for(const [extra,status,code] of [[{origin:'https://invalid.example'},403,'ORIGIN_REJECTED'],[{'content-type':'text/plain'},415,'JSON_REQUIRED'],[{'x-csrf-token':'invalid'},403,'CSRF_REJECTED'],[{},400,'INVALID_PROJECTOPS_PAYLOAD']] as const){
      const r=await fetch(origin+'/projectops/clients',{method:'POST',headers:{...headers,...extra},body:'null'});assert.equal(r.status,status);const data=await r.json();assert.equal(data.code,code);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    }
    const missing=await fetch(origin+'/projectops/project-requests/missing',{headers});assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');
    const malformed=await fetch(origin+'/projectops/clients',{method:'POST',headers,body:'{'});assert.equal(malformed.status,400);assert.equal((await malformed.json()).code,'MALFORMED_JSON_BODY');assert.equal(malformed.headers.get('cache-control'),'no-store');
    const unauth=await fetch(origin+'/projectops/dashboard');assert.equal(unauth.status,401);assert.equal(unauth.headers.get('cache-control'),'no-store');
    const post=(url:string,data:unknown)=>fetch(origin+url,{method:'POST',headers,body:JSON.stringify(data)});
    assert.equal((await post('/projectops/clients',{id:'c',name:'Header fixture'})).status,200);
    assert.equal((await post('/projectops/project-requests',{id:'p',clientId:'c',title:'Header fixture',brief:'Fixture'})).status,200);
    const conflict=await post('/projectops/project-requests/p/control',{action:'cancel',expectedRevision:2});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'PROJECTOPS_PROJECT_CHANGED');assert.equal(conflict.headers.get('cache-control'),'no-store');assert.equal(conflict.headers.get('x-content-type-options'),'nosniff');
    failAuth=true;const internal=await fetch(origin+'/projectops/dashboard',{headers});assert.equal(internal.status,500);assert.equal(internal.headers.get('cache-control'),'no-store');assert.equal(internal.headers.get('x-content-type-options'),'nosniff');assert.doesNotMatch(await internal.text(),/Injected/);
  }finally{await app.close();}
});

test('Recovery refuses unsafe target identities and insecure/implicit credential configuration; release packaging is bounded',async()=>{
  for(const id of ['', 'postgres','projectops','projectops_restore_source','projectops_restore_'+ 'a'.repeat(32)+'; DROP DATABASE source'])assert.throws(()=>validateRestoreDatabase(id));
  assert.equal(validateRestoreDatabase(newRestoreDatabaseName()).length,51);
  await assert.rejects(()=>privateLibpqEnvironment({}),/PGSERVICEFILE/);
  const directory=await mkdtemp(path.join(tmpdir(),'projectops-guards-'));
  try{
    const file=path.join(directory,'services');await writeFile(file,'[source]\nhost=localhost\ndbname=source\nuser=operator\n',{mode:0o600});
    assert.equal((await privateLibpqEnvironment({PGSERVICEFILE:file})).PGSERVICEFILE,file);await chmod(file,0o644);await assert.rejects(()=>privateLibpqEnvironment({PGSERVICEFILE:file}),/private/);
    await assert.rejects(()=>createRuntimeRelease({root:process.cwd(),destination:process.cwd(),checkpoint:'a'.repeat(40)}),/outside/);
    const release=await createRuntimeRelease({root:process.cwd(),destination:path.join(directory,'release'),checkpoint:'a'.repeat(40)});
    assert.equal(release.manifest.format,'projectops.source-runtime');assert.ok(release.manifest.files.some(f=>f.path.endsWith('0007_automatic_history.sql')));assert.ok(release.manifest.files.every(f=>!f.path.includes('node_modules')&&!f.path.startsWith('.env')&&!f.path.startsWith('tests/')));
    assert.equal(JSON.parse(await readFile(path.join(release.destination,'release-manifest.json'),'utf8')).sha256,release.manifest.sha256);
    const again=await createRuntimeRelease({root:process.cwd(),destination:path.join(directory,'again'),checkpoint:'a'.repeat(40)});assert.equal(again.manifest.sha256,release.manifest.sha256);
    await assert.rejects(()=>createRuntimeRelease({root:process.cwd(),destination:release.destination,checkpoint:'a'.repeat(40)}));
    await symlink(process.cwd(),path.join(directory,'checkout-link'),'dir');
    await assert.rejects(()=>createRuntimeRelease({root:process.cwd(),destination:path.join(directory,'checkout-link','unsafe-release'),checkpoint:'a'.repeat(40)}),/outside/);
    await chmod(file,0o600);const unsafe=path.join(process.cwd(),'unsafe-backups');
    await assert.rejects(()=>backupProjectOps({sourceService:'source',sourceIdentity:'guard-fixture',directory:unsafe,env:{PGSERVICEFILE:file}}),/outside/);await assert.rejects(()=>fileAccess(unsafe));
    for(const extra of ['[source]\nhost=other\ndbname=other\nuser=other\n','host=other\n']){
      await writeFile(file,'[source]\nhost=localhost\ndbname=source\nuser=operator\n'+extra);
      await assert.rejects(()=>backupProjectOps({sourceService:'source',sourceIdentity:'guard-fixture',directory:path.join(directory,'ambiguous'),env:{PGSERVICEFILE:file}}),/unambiguous/);await assert.rejects(()=>fileAccess(path.join(directory,'ambiguous')));
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('Explicit deployed smoke fails closed without HTTPS, write approval, private credentials or verified revision',async()=>{
  const config={origin:'https://approved.onrender.com',authorizeAcceptanceWrites:true,login:'operator',password:randomBytes(24).toString('hex'),checkpoint:'a'.repeat(40),renderDeployedCheckpoint:'a'.repeat(40)};
  for(const value of [null,{}, {...config,origin:'http://localhost'}, {...config,origin:'https://approved.onrender.com/path'}, {...config,authorizeAcceptanceWrites:false}, {...config,password:undefined}, {...config,renderDeployedCheckpoint:'b'.repeat(40)}])assert.throws(()=>validateDeployedSmoke(value));
  assert.equal(validateDeployedSmoke(config),config);
  assert.throws(()=>validateDeployedSmoke({...config,phase:'after-restart'}));
  assert.throws(()=>validateDeployedSmoke({...config,phase:'unknown'}));
  for(const input of ['',JSON.stringify({...config,origin:'http://localhost'})]){
    const child=spawn(process.execPath,['--experimental-strip-types','scripts/projectops-deployed-smoke.mjs'],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.stdin.end(input);assert.equal((await once(child,'close'))[0],1);assert.ok(!output.includes(config.password));assert.match(output,/No checks were skipped/);
  }
});
