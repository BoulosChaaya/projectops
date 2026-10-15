import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectOpsAccess } from '../apps/api/src/projectops/access.ts';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { ProjectOpsMemorySqlExecutor } from '../packages/projectops/src/index.ts';
import { validateOperatorDefaults, validateOperatorLogin, validateOperatorPassword } from '../packages/projectops/src/operator.ts';
import { validateProjectOpsOrigin } from '../apps/api/src/projectops/postgres-app.ts';
import { clientFixture } from './client-fixture.ts';

test('Operator boundaries reject invalid defaults, weak credentials and insecure public origins', () => {
  assert.equal(validateOperatorLogin(' Operator '), 'operator');
  assert.throws(() => validateOperatorLogin('<script>'));
  assert.throws(() => validateOperatorPassword('short'));
  assert.throws(() => validateOperatorPassword('x'.repeat(513)));
  for (const value of [null, {}, { defaultCurrency: 'usd', defaultPriority: 'high', timezone: 'UTC' }, { defaultCurrency: 'USD', defaultPriority: 'urgent', timezone: 'UTC' }, { defaultCurrency: 'USD', defaultPriority: 'low', timezone: 'invalid' }]) assert.throws(() => validateOperatorDefaults(value));
  assert.throws(() => validateProjectOpsOrigin('0.0.0.0'));
  assert.throws(() => validateProjectOpsOrigin('0.0.0.0', 'http://example.com'));
  assert.throws(() => validateProjectOpsOrigin('127.0.0.1', 'https://example.com/path'));
  assert.equal(validateProjectOpsOrigin('0.0.0.0', 'https://example.com'), 'https://example.com');
});

test('All product routes require a session and writes enforce Origin, JSON and CSRF', async () => {
  let revoked = false;
  const session = { login: 'operator', csrfToken: 'csrf', tokenHash: 'hash', defaults: { defaultCurrency: 'EUR', defaultPriority: 'high' as const, timezone: 'UTC' } };
  const access = new ProjectOpsAccess({
    async resolve(token) { return token === 'valid' && !revoked ? session : null; },
    async login() { return { rawToken: 'valid', csrfToken: 'csrf' }; },
    async logout() { revoked = true; },
    async saveDefaults(value) { return validateOperatorDefaults(value); },
    async changeCredentials() { return true; },
  });
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), host: 'localhost', port: 0, access, clientDir: await clientFixture() });
  const origin = app.server.origin;
  assert.equal(new URL(origin).hostname, 'localhost');
  try {
    // The only sessionless product routes: whether a demo is offered, and starting one (absent here).
    const publicDemo = ['/projectops/demo', '/projectops/demo/start'];
    assert.deepEqual(app.routes.filter(r => r.path.startsWith('/projectops/demo')).map(r => r.path).sort(), [...publicDemo, '/projectops/demo/reset'].sort());
    assert.deepEqual(await fetch(origin + '/projectops/demo').then(r => r.json()), { enabled: false });
    assert.equal((await fetch(origin + '/projectops/demo/start', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status, 404);
    for (const route of app.routes.filter(r => !r.path.includes('/access/') && r.path !== '/projectops/login' && r.path !== '/projectops/assets/:file' && !publicDemo.includes(r.path))) {
      const method = typeof route.method === 'string' ? route.method : route.method[0];
      const response = await fetch(origin + route.path.replaceAll(/:[^/]+/g, 'probe'), { method, redirect: 'manual', ...(method !== 'GET' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });
      assert.equal(response.status, (['/projectops', '/projectops/settings'].includes(route.path) || route.path.startsWith('/projectops/client-management') || route.path.startsWith('/projectops/projects/')) ? 302 : 401, route.path);
    }
    const headers = { cookie: 'projectops_session=valid', origin, 'content-type': 'application/json', 'x-csrf-token': 'csrf' };
    const write = (extra: Record<string, string>) => fetch(origin + '/projectops/clients', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ id: 'c', name: 'Client' }) });
    assert.equal((await write({ origin: 'https://evil.example' })).status, 403);
    assert.equal((await write({ 'x-csrf-token': '' })).status, 403);
    assert.equal((await write({ 'content-type': 'text/plain' })).status, 415);
    assert.equal((await write({ cookie: 'projectops_session=valid; projectops_session=valid' })).status, 401);
    assert.equal((await write({})).status, 200);
    const response = await fetch(origin + '/projectops/project-requests', { method: 'POST', headers, body: JSON.stringify({ id: 'r', clientId: 'c', title: 'Title', brief: 'Brief' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).priority, 'high');
    const login = await fetch(origin + '/projectops/login');
    assert.match(login.headers.get('content-security-policy')!, /script-src 'self'/);
    assert.match(await login.text(), /<div id="root">/, 'sign-in is the React client');
    const settings = await fetch(origin + '/projectops/settings', { headers });
    assert.equal(settings.headers.get('cache-control'), 'no-store');
    assert.match(await settings.text(), /<div id="root">/, 'settings is the React client, served only with a session');
    assert.equal((await fetch(origin + '/projectops/access/logout', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal((await fetch(origin + '/projectops/clients', { headers })).status, 401);
  } finally { await app.close(); }
});
