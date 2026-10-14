import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function validateDeployedSmoke(value) {
  if (!value || typeof value !== 'object') throw Error('Explicit deployed acceptance configuration is required.');
  let url; try { url = new URL(value.origin); } catch { throw Error('An approved HTTPS origin is required.'); }
  if (url.protocol !== 'https:' || url.origin !== value.origin || url.username || url.password) throw Error('An approved HTTPS origin is required.');
  if (value.authorizeAcceptanceWrites !== true) throw Error('Explicit acceptance-data write authorization is required.');
  if (typeof value.login !== 'string' || !value.login || typeof value.password !== 'string' || !value.password) throw Error('Private credentials are required at execution time.');
  if (typeof value.checkpoint !== 'string' || !/^[a-f0-9]{40}$/.test(value.checkpoint)) throw Error('Expected release checkpoint is required.');
  if (![undefined, 'initial', 'after-restart'].includes(value.phase)) throw Error('Unknown acceptance phase.');
  if (value.phase === 'after-restart' && (value.renderRestartCompleted !== true || !/^[a-f0-9-]{36}$/.test(value.projectId ?? '') || !/^[a-f0-9-]{36}$/.test(value.clientId ?? '') || !/^[a-f0-9]{64}$/.test(value.snapshotSha256 ?? ''))) throw Error('A verified external restart and prior acceptance receipt are required.');
  if (value.phase === 'after-restart' && (!value.operatorDefaults || ['defaultCurrency','defaultPriority','timezone'].some(key => typeof value.operatorDefaults[key] !== 'string'))) throw Error('Prior saved operator defaults are required.');
  return value;
}
export async function runDeployedSmoke(config) {
  validateDeployedSmoke(config);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true }); // TLS verification remains enabled.
  const page = await context.newPage(), errors = [];
  page.on('pageerror', () => errors.push('page error'));
  page.on('console', message => { if (message.type() === 'error') errors.push('console error'); });
  const check = (condition, label) => { if (!condition) throw Error('Deployed acceptance failed: ' + label); };
  const { origin } = config;
  try {
    for (const route of ['/health/live','/health/ready']) check((await context.request.get(origin + route)).status() === 200, route);
    // The service reports the commit it runs (Render's RENDER_GIT_COMMIT), so the target is verified, not attested.
    const deployed = (await (await context.request.get(origin + '/health/live')).json()).details?.commit;
    if (deployed !== config.checkpoint) throw Error(`Deployed commit ${deployed ?? 'unknown'} is not the expected ${config.checkpoint}; wait for the deploy to finish.`);
    const denied = await context.request.get(origin + '/projectops/dashboard'); check(denied.status() === 401, 'API authentication'); check(denied.headers()['cache-control'] === 'no-store', 'private denied response');
    const redirect = await context.request.get(origin + '/projectops', { maxRedirects: 0 }); check(redirect.status() === 302 && redirect.headers().location === '/projectops/login', 'page authentication');
    await page.goto(origin + '/projectops/login');
    await page.getByLabel('Login', { exact: true }).fill(config.login); await page.getByLabel('Password', { exact: true }).fill(config.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/projectops');
    const cookie = (await context.cookies()).find(c => c.name === '__Host-projectops_session');
    check(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/', 'secure session cookie');
    const sessionResponse = await context.request.get(origin + '/projectops/access/session'); check(sessionResponse.headers()['cache-control'] === 'no-store', 'session cache');
    const session = await sessionResponse.json(); check(session.login === config.login, 'session identity');
    await page.goto(origin + '/projectops/settings'); await page.getByLabel('Timezone', { exact: true }).waitFor();
    await page.waitForFunction(() => !(document.querySelector('#defaults button')).disabled);
    check(await page.getByLabel('Timezone', { exact: true }).inputValue() === session.defaults.timezone, 'saved timezone');
    const headers = { origin, 'x-csrf-token': session.csrfToken };
    for (const [extra, expected] of [[{origin:'https://invalid.example'},403],[{'x-csrf-token':'invalid'},403],[{'content-type':'text/plain'},415]]) {
      const r = await context.request.post(origin + '/projectops/clients', { headers: { ...headers, ...extra }, data: {} });
      check(r.status() === expected && r.headers()['cache-control'] === 'no-store' && r.headers()['x-content-type-options'] === 'nosniff', 'write protection');
    }
    const fingerprint = artifact => createHash('sha256').update(JSON.stringify({project:artifact.project,client:artifact.client,collections:artifact.collections,financeTotalsByCurrency:artifact.financeTotalsByCurrency})).digest('hex');
    if (config.phase === 'after-restart') {
      // The operator must complete/verify the external Render action before invoking this read-only phase.
      check(['defaultCurrency','defaultPriority','timezone'].every(key => session.defaults[key] === config.operatorDefaults[key]), 'restart operator settings');
      const root = '/projectops/project-requests/' + config.projectId;
      const artifact = await context.request.get(origin + root + '/export').then(r => {check(r.status() === 200, 'restored acceptance export'); return r.json();});
      check(artifact.client.id === config.clientId && artifact.project.status === 'archived' && fingerprint(artifact) === config.snapshotSha256, 'restart persistence');
      await page.goto(origin + '/projectops/projects/' + config.projectId); await page.locator('#records-activities article').first().waitFor();
      await page.goto(origin + '/projectops/projects/' + config.projectId + '/delivery-summary'); await page.getByText('Current project status: archived', {exact:true}).waitFor();
      check((await page.goto(origin + '/projectops')).status() === 200, 'dashboard'); await page.locator('.metric').first().waitFor(); check(errors.length === 0, 'unexpected browser errors');
      return {passed:true,checkpoint:config.checkpoint,projectId:config.projectId,clientId:config.clientId,snapshotSha256:config.snapshotSha256,operatorDefaults:session.defaults,restartVerified:true,externalRestart:'operator-verified Render action'};
    }
    // Production smoke writes only the explicitly authorized representative acceptance dataset.
    await page.goto(origin + '/projectops/client-management');
    await page.locator('#create [name=name]').fill('ProjectOps deployed acceptance'); await page.locator('#create button').click(); await page.waitForURL('**/client-management/*');
    const clientId = page.url().split('/').at(-1);
    await page.waitForFunction(() => !(document.querySelector('#create-project button')).disabled);
    await page.locator('#create-project [name=title]').fill('ProjectOps deployed acceptance'); await page.locator('#create-project [name=brief]').fill('Authorized deployed verification'); await page.locator('#create-project button').click(); await page.waitForURL('**/projects/*');
    const projectId = page.url().split('/').at(-1), root = '/projectops/project-requests/' + projectId;
    const response = await context.request.get(origin + root); check(response.status() === 200 && response.headers()['cache-control'] === 'no-store', 'persistent project');
    const html = await page.goto(page.url()); check(html.headers()['content-security-policy']?.includes("frame-ancestors 'none'"), 'workspace CSP');
    for (const id of ['invoices','expenses','activities']) await page.locator('#' + id).getByRole('heading').first().waitFor();
    async function form(selector, fields) {
      for (const [key,value] of Object.entries(fields)) await page.locator(selector + ' [name=' + key + ']').fill(value);
      const pending = page.waitForResponse(r => ['POST','PUT'].includes(r.request().method()) && r.url().includes(root));
      await page.locator(selector + ' button').first().click(); check((await pending).status() === 200, selector);
    }
    async function control(name, confirm) {
      await page.getByRole('button',{name,exact:true}).click(); const pending = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(root));
      await page.getByRole('button',{name:confirm,exact:true}).click(); check((await pending).status() === 200, name);
    }
    async function terminal(name) {
      const pending = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(root));
      await page.getByRole('button',{name,exact:true}).click(); check((await pending).status() === 200, name);
    }
    await form('#estimate-form',{amount:'100',currency:'GBP'});
    await control('Approve estimate','Confirm approval'); await control('Start project','Confirm start');
    await form('#create-deliverable',{title:'Deployed acceptance result',artifactUrl:'https://example.com/projectops-acceptance'}); await terminal('Accept deliverable');
    await form('#create-feedback',{author:'Deployed acceptance source',message:'Authorized acceptance review'}); await terminal('Address feedback');
    await form('#create-invoice',{invoiceNumber:'DEPLOYED-EUR',amountCents:'100000',currency:'EUR'}); await terminal('Record payment');
    await form('#create-expense',{description:'Deployed acceptance expense',amountCents:'5000',currency:'USD'}); await terminal('Approve expense');
    await page.locator('#finance-totals').getByText('Paid invoices: 1000.00 EUR',{exact:true}).waitFor();
    await control('Mark delivered','Confirm delivery'); await control('Archive project','Confirm archive');
    const exportResponse = await context.request.get(origin + root + '/export'); check(exportResponse.status() === 200 && exportResponse.headers()['content-disposition']?.includes('attachment;') && exportResponse.headers()['cache-control'] === 'no-store', 'export attachment');
    const artifact = await exportResponse.json(); check(artifact.project.id === projectId && artifact.generatedBy === session.login, 'export source');
    check(artifact.collections.activities.length === 14 && artifact.collections.activities.every(a => a.actor === session.login), 'automatic workflow history');
    check(artifact.financeTotalsByCurrency.EUR.paidInvoiceAmountCents === '100000' && artifact.financeTotalsByCurrency.USD.approvedExpenseAmountCents === '5000' && artifact.collections.expenses[0].decidedBy === session.login, 'exact finance and identity');
    await page.goto(origin + '/projectops/projects/' + projectId + '/delivery-summary'); await page.getByText('Current project status: archived',{exact:true}).waitFor();
    await page.getByText('Deployed acceptance result',{exact:true}).waitFor();
    check((await page.goto(origin + '/projectops')).status() === 200, 'dashboard'); await page.locator('.metric').first().waitFor(); check(errors.length === 0, 'unexpected browser errors');
    // Dashboard search uses the C.utf8 collation, which the provider's PostgreSQL must provide.
    check((await context.request.get(origin + '/projectops/dashboard?q=acceptance')).status() === 200, 'dashboard search (C.utf8 collation)');
    return { passed: true, checkpoint: config.checkpoint, clientId, projectId, archived: true, snapshotSha256: fingerprint(artifact), operatorDefaults: session.defaults, restartVerified: false };
  } finally { await context.close(); await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let secrets = [];
  try {
    let input = ''; for await (const part of process.stdin) { input += part; if (input.length > 8192) throw Error('Input too large.'); }
    const config = JSON.parse(input);
    secrets = [config?.login, config?.password].filter(value => typeof value === 'string' && value.length > 0);
    console.log(JSON.stringify(await runDeployedSmoke(config)));
  } catch (error) {
    // Report which check failed (first line only; Playwright appends call logs) with credentials removed.
    let reason = (error instanceof Error ? error.message : 'unknown error').split('\n')[0];
    for (const secret of secrets) reason = reason.split(secret).join('[Redacted]');
    console.error('ProjectOps deployed acceptance failed: ' + reason + ' No checks were skipped.');
    process.exitCode = 1;
  }
}
