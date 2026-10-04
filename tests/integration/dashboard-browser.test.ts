import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { operatorFixture } from './operator-fixture.ts';
import { ProjectOpsRepository, ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection } from '../../packages/projectops/src/index.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { loadProjectOpsPostgresMigrations, migrateProjectOpsPostgres } from '../../packages/projectops/src/postgres-migrations.ts';
import { startProjectOpsApp } from '../../apps/api/src/projectops/app.ts';
import { ProjectOpsAccess } from '../../apps/api/src/projectops/access.ts';
import { seedDashboard, NOW } from '../dashboard-fixture.ts';

test('Operational dashboard Chromium journey searches, filters, navigates, retries and displays timezone-safe exact operational data without writes',async()=>{
  await operatorFixture(async(_url,pool)=>{
    const client=await pool.connect();try{await migrateProjectOpsPostgres(client,await loadProjectOpsPostgresMigrations());}finally{client.release();}
    const sql=new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool));const base=new ProjectOpsRepository(sql);
    const store=new ProjectOpsOperatorStore(pool);await store.provision('operator','dashboard-browser-password');
    await store.saveDefaults({defaultCurrency:'GBP',defaultPriority:'medium',timezone:'Asia/Beirut'});
    let unavailable=false;
    const app=await startProjectOpsApp({sql:{transaction:run=>sql.transaction(run),query:async statement=>{if(unavailable&&statement.sql.includes('WITH dashboard_scope'))throw Error('Private failure');return sql.query(statement);}},clock:()=>NOW,access:new ProjectOpsAccess(store),host:'127.0.0.1',port:0});let browser;
    try {
      browser=await chromium.launch({headless:true});const context=await browser.newContext({timezoneId:'America/Los_Angeles'}),page=await context.newPage();
      const errors:string[]=[],writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
      await page.goto(app.server.origin+'/projectops');await page.getByLabel('Login',{exact:true}).fill('operator');await page.getByLabel('Password',{exact:true}).fill('dashboard-browser-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/projectops');
      await page.getByText('No active project requests yet',{exact:true}).waitFor();
      await page.getByText('No overdue work.',{exact:true}).waitFor();await page.getByText('No upcoming deadlines.',{exact:true}).waitFor();await page.getByText('No outstanding invoices.',{exact:true}).waitFor();
      let tick=0;await seedDashboard(base.withHistory({actor:'operator',clock:()=>new Date(Date.parse(NOW)+tick++).toISOString()}));
      const snapshot=async()=>({projects:(await pool.query('SELECT row_to_json(p) AS row FROM projectops_project_requests p ORDER BY id')).rows,activities:(await pool.query('SELECT row_to_json(a) AS row FROM projectops_project_activities a ORDER BY project_request_id,id')).rows});
      const before=await snapshot();writes.length=0;
      await page.reload();await page.getByText(/7 matching projects/).waitFor();assert.match((await page.locator('.result-scope').last().textContent())!,/Asia\/Beirut/);
      assert.match((await page.locator('#upcoming-title').locator('..').textContent())!,/2:00 PM/); // Noon UTC is 14:00 Beirut, independent of browser/server timezone.
      assert.equal(await page.locator('img,script').count(),0);await page.getByText('<b>Other</b>',{exact:true}).waitFor();
      const overdue=page.locator('#overdue-title').locator('..'),upcoming=page.locator('#upcoming-title').locator('..'),outstanding=page.locator('#outstanding-title').locator('..');
      assert.match((await overdue.textContent())!,/14 open tasks\/milestones overdue/);
      assert.match((await outstanding.textContent())!,/16 issued invoices/);assert.match((await outstanding.textContent())!,/EUR 120,000,000\.00/);assert.match((await outstanding.textContent())!,/USD 1\.24/);assert.ok(!(await outstanding.textContent())!.includes('GBP'));
      assert.equal(await page.locator('.workflow-column[data-status="on_hold"]').count(),1);
      const apply=async(q:string,status='all')=>{await page.getByLabel('Search projects').fill(q);await page.getByLabel('Status',{exact:true}).selectOption(status);await page.getByRole('button',{name:'Apply',exact:true}).click();await page.waitForLoadState('load');};
      await apply('Project approved','approved');assert.match(page.url(),/q=Project\+approved&status=approved/);await page.getByText(/1 matching projects/).waitFor();assert.match((await outstanding.textContent())!,/4 issued invoices/);assert.match((await outstanding.textContent())!,/EUR 30,000,000\.00/);assert.match((await overdue.textContent())!,/3 open tasks\/milestones/);
      await page.reload();assert.equal(await page.getByLabel('Search projects').inputValue(),'project approved');assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),'approved');
      await apply('Studio','on_hold');await page.getByText(/1 matching projects/).waitFor();assert.match((await page.locator('.result-scope').first().textContent())!,/On Hold/);
      await page.getByRole('link',{name:'Reset',exact:true}).click();await page.waitForURL(app.server.origin+'/projectops');await page.getByText(/7 matching projects/).waitFor();await page.goBack();assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),'on_hold');await page.goForward();
      await apply('Project approved','delivered');await page.getByText('No matching projects',{exact:true}).waitFor();await page.getByText('No overdue work.',{exact:true}).waitFor();await page.getByText('No outstanding invoices.',{exact:true}).waitFor();
      await apply('','delivered');await page.getByText(/1 matching projects/).waitFor();assert.match((await overdue.textContent())!,/3 open tasks\/milestones/);assert.match((await upcoming.textContent())!,/Project delivered · milestone/);assert.ok(!(await upcoming.textContent())!.includes('· project:'));
      const planningLink=overdue.getByRole('link').filter({hasText:'· task:'}).first();assert.equal(await planningLink.getAttribute('href'),'/projectops/projects/delivered#tasks');await planningLink.click();await page.locator('#tasks').getByText('<img src=x onerror=alert(1)> overdue task',{exact:true}).waitFor();
      await page.goto(app.server.origin+'/projectops?status=delivered');const financeLink=page.locator('#outstanding-title').locator('..').getByRole('link',{name:'Invoices for Project delivered',exact:true});assert.equal(await financeLink.getAttribute('href'),'/projectops/projects/delivered#invoices');await financeLink.click();await page.locator('#invoices').getByText('No date',{exact:true}).waitFor();
      for(const state of ['new','estimated','approved','in_progress','on_hold','delivered']){
        await page.goto(app.server.origin+'/projectops?status='+state);assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),state);await page.locator('.requests[aria-labelledby="active-requests-title"]').getByText('Project '+state,{exact:true}).waitFor();
      }
      await page.goto(app.server.origin+'/projectops?status=new&q=%3Cb%3EOther%3C%2Fb%3E');await page.getByText('No overdue work.',{exact:true}).waitFor();await page.getByText('No upcoming deadlines.',{exact:true}).waitFor();await page.getByText('No outstanding invoices.',{exact:true}).waitFor();assert.equal(await page.locator('b').count(),0);
      unavailable=true;const failed=await page.goto(app.server.origin+'/projectops?q=studio&status=on_hold');assert.equal(failed!.status(),500);await page.getByText('Dashboard unavailable. No current metrics could be loaded.',{exact:true}).waitFor();assert.equal(await page.locator('.metric').count(),0);assert.equal(await page.getByRole('link',{name:'Retry dashboard',exact:true}).getAttribute('href'),'/projectops?q=studio&status=on_hold');
      unavailable=false;await page.getByRole('link',{name:'Retry dashboard',exact:true}).click();await page.getByText(/1 matching projects/).waitFor();assert.equal(await page.getByLabel('Status',{exact:true}).inputValue(),'on_hold');
      await page.setViewportSize({width:375,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'Apply',exact:true}).waitFor();
      assert.deepEqual(await snapshot(),before);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
    }finally{await browser?.close();await app.close();}
  });
});
