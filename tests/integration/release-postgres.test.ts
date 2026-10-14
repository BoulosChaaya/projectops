import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { finalDatabaseFixture } from './final-fixture.ts';
import { loadProjectOpsPostgresMigrations } from '../../packages/projectops/src/postgres-migrations.ts';
import { createRuntimeRelease } from '../../scripts/projectops-release.mjs';

const execute=promisify(execFile);
// encoding 'utf8' is execFile's default; stating it lets the compiler type stdout as a string.
async function command(file:string,args:string[],options:object):Promise<{stdout:string;stderr:string}>{try{return await execute(file,args,{...options,encoding:'utf8',maxBuffer:1024*1024});}catch{throw Error('Isolated release command failed.');}}

test('Isolated source-runtime release installs frozen production dependencies, starts real entrypoint, loads migrations and persists through SIGTERM/restart', {timeout:120000},async()=>{
 await finalDatabaseFixture(async f=>{
  const checkpoint=(await command('git',['rev-parse','HEAD'],{cwd:process.cwd()})).stdout.trim();
  const release=await createRuntimeRelease({root:process.cwd(),destination:path.join(f.directory,'release'),checkpoint});
  assert.equal(release.manifest.format,'projectops.source-runtime');
  await command('corepack',['pnpm','install','--prod','--frozen-lockfile'],{cwd:release.destination,env:{...process.env,CI:'true'}});
  const secret=randomBytes(24).toString('base64url'),baseEnv={...process.env,DATABASE_URL:f.databaseUrl,HOST:'127.0.0.1',PORT:'0'};
  const provision=spawn(process.execPath,['--experimental-strip-types','apps/api/src/projectops/provision-operator.ts'],{cwd:release.destination,env:baseEnv,stdio:['pipe','pipe','pipe']});provision.stdout.resume();provision.stderr.resume();provision.stdin.end(JSON.stringify({login:'operator',password:secret}));assert.equal((await once(provision,'close'))[0],0);
  async function start(env:any=baseEnv,entry='apps/api/src/projectops/main.ts'){
    const child=spawn(process.execPath,['--experimental-strip-types',entry],{cwd:release.destination,env,stdio:['ignore','pipe','pipe']});
    child.stderr.resume();let output='';
    const origin=await new Promise<string>((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;const match=/ProjectOps listening at (http:\/\/[^\s]+)/.exec(output);if(match)resolve(match[1]);});child.once('exit',()=>reject(Error('Release failed before readiness.')));});
    return {child,origin,close:async()=>{const closed=once(child,'close');child.kill('SIGTERM');assert.equal((await closed)[0],0);}};
  }
  let app=await start();
  try{
    for(const route of ['/health/live','/health/ready'])assert.equal((await fetch(app.origin+route)).status,200);
    assert.equal((await fetch(app.origin+'/projectops/dashboard')).status,401);
    const login=await fetch(app.origin+'/projectops/access/login',{method:'POST',headers:{origin:app.origin,'content-type':'application/json'},body:JSON.stringify({login:'operator',password:secret})});assert.equal(login.status,200);
    const credentials=await login.json(),headers={origin:app.origin,cookie:login.headers.get('set-cookie')!.split(';')[0],'content-type':'application/json','x-csrf-token':credentials.csrfToken};
    assert.equal((await fetch(app.origin+'/projectops/clients',{method:'POST',headers,body:JSON.stringify({id:'release-client',name:'Isolated release client'})})).status,200);
    await app.close();app=await start();
    const read=await fetch(app.origin+'/projectops/clients/release-client',{headers});assert.equal(read.status,200);assert.equal((await read.json()).name,'Isolated release client');assert.equal(read.headers.get('cache-control'),'no-store');
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM projectops_schema_migrations')).rows[0].n,(await loadProjectOpsPostgresMigrations()).length);
    // Startup never re-applies migrations; compare names/checksums against a second startup ledger.
    const ledger=(await f.pool.query('SELECT * FROM projectops_schema_migrations ORDER BY version')).rows;await app.close();app=await start();assert.deepEqual((await f.pool.query('SELECT * FROM projectops_schema_migrations ORDER BY version')).rows,ledger);
  }finally{await app.close();}
  // Exercise the native Render start wrapper and configured HTTPS Origin over a loopback transport.
  // This verifies configuration/cookie rules; it does not claim a real deployed HTTPS connection.
  const renderOrigin='https://approved-projectops.onrender.com',render=await start({...baseEnv,PUBLIC_ORIGIN:undefined,RENDER_EXTERNAL_URL:renderOrigin},'scripts/projectops-render-start.mjs');
  try{
    assert.equal((await fetch(render.origin+'/health/ready')).status,200);
    const login=await fetch(render.origin+'/projectops/access/login',{method:'POST',headers:{origin:renderOrigin,'content-type':'application/json'},body:JSON.stringify({login:'operator',password:secret})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')!;assert.match(cookie,/^__Host-projectops_session=/);for(const property of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(cookie.includes(property));assert.doesNotMatch(cookie,/Domain=/i);
    const rejected=await fetch(render.origin+'/projectops/access/login',{method:'POST',headers:{origin:render.origin,'content-type':'application/json'},body:'{}'});assert.equal(rejected.status,403);assert.equal(rejected.headers.get('cache-control'),'no-store');
  }finally{await render.close();}
  for(const env of [{...baseEnv,DATABASE_URL:''},{...baseEnv,DATABASE_URL:'invalid-private-configuration'},{...baseEnv,HOST:'0.0.0.0',PUBLIC_ORIGIN:'http://invalid.example'}]){
    const child=spawn(process.execPath,['--experimental-strip-types','apps/api/src/projectops/main.ts'],{cwd:release.destination,env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);assert.equal((await once(child,'close'))[0],1);assert.match(output,/ProjectOps startup failed/);assert.ok(!output.includes(secret)&&!output.includes(f.databaseUrl));
  }
  console.log('Release acceptance: source-runtime digest '+release.manifest.sha256+'; frozen production install, migrations, entrypoint, SIGTERM/restart PASS.');
 });
});
