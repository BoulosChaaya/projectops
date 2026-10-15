import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startProjectOpsApp } from '../apps/api/src/projectops/app.ts';
import { DEFAULT_CLIENT_DIR, createClientApp } from '../apps/web/src/projectops/client-app.ts';
import { ProjectOpsMemorySqlExecutor } from '../packages/projectops/src/index.ts';
import { clientFixture } from './client-fixture.ts';

test('Client assets are served by exact hashed name with their type, and nothing outside assets/ is reachable', async () => {
  const app = await startProjectOpsApp({ sql: new ProjectOpsMemorySqlExecutor(), host: '127.0.0.1', port: 0, clientDir: await clientFixture() });
  try {
    const get = (asset: string) => fetch(`${app.server.origin}/projectops/assets/${asset}`);
    for (const [asset, type] of [['app-abc123.js', 'text/javascript; charset=utf-8'], ['app-abc123.css', 'text/css; charset=utf-8'], ['font-abc123.woff2', 'font/woff2']]) {
      const response = await get(asset);
      assert.equal(response.status, 200, asset);
      assert.equal(response.headers.get('content-type'), type);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    assert.equal(await (await get('app-abc123.js')).text(), 'console.log("client");');
    // Encoded separators and dot segments decode into the parameter; they must still be refused.
    for (const attempt of ['..%2Fsecret.txt', '%2e%2e%2Fsecret.txt', '..%2F..%2Fpackage.json', '..%5Csecret.txt', '.hidden.js', 'missing-abc.js', 'app-abc123.txt', 'app-abc123.js%00.css', 'a..js']) {
      assert.equal((await get(attempt)).status, 404, attempt);
    }
    // fetch() normalizes dot segments before sending; send raw paths to test what the server does.
    for (const raw of ['/projectops/assets/../secret.txt', '/projectops/assets/../../package.json', '/projectops/assets/%2e%2e/secret.txt']) {
      const status = await new Promise<number>((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: app.server.port, path: raw }, response => { response.resume(); resolve(response.statusCode!); }).on('error', reject);
      });
      assert.equal(status, 404, raw);
    }
  } finally { await app.close(); }
});

test('The client shell has a same-origin CSP; a missing build answers 503 and recovers once built', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'projectops-client-missing-'));
  try {
    const client = createClientApp(directory);
    await assert.rejects(client.shell(), (error: { status?: number; code?: string }) => error.status === 503 && error.code === 'CLIENT_NOT_BUILT');
    await writeFile(path.join(directory, 'index.html'), '<div id="root"></div>');
    const shell = await client.shell();
    assert.equal(shell.status, 200);
    const csp = shell.headers['content-security-policy']!;
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/, 'no inline or remote scripts');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(shell.headers['cache-control'], 'no-store');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('The production build loads only same-origin hashed assets, with no inline script or style', () => {
  const index = path.join(DEFAULT_CLIENT_DIR, 'index.html');
  assert.ok(existsSync(index), 'apps/client/dist is missing: run `pnpm build` (pnpm verify builds it first)');
  const html = readFileSync(index, 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'inline script would be blocked by the CSP');
  assert.doesNotMatch(html, /<style|\sstyle=/, 'inline style would be blocked by the CSP');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]!);
  assert.ok(references.some(reference => reference.endsWith('.js')) && references.some(reference => reference.endsWith('.css')));
  for (const reference of references) {
    assert.match(reference, /^\/projectops\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(js|css)$/, reference);
    assert.ok(existsSync(path.join(DEFAULT_CLIENT_DIR, 'assets', path.basename(reference))), reference);
  }
});
