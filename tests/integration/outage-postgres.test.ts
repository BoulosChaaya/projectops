import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsOperatorStore } from '../../packages/projectops/src/operator.ts';
import { createLogger } from '../../packages/logger/src/index.ts';
import { createMemorySink } from '../../packages/logger/src/sink.ts';

// A TCP relay between the application and PostgreSQL, so the test can cut the database off from
// this one application (dropping open connections and refusing new ones) without stopping the
// shared server other suites are using, then restore it on the same port.
async function relay(target: { host: string; port: number }) {
  const sockets = new Set<net.Socket>();
  let server: net.Server | undefined;
  let port = 0;
  const open = () => new Promise<void>(resolve => {
    server = net.createServer(client => {
      const upstream = net.connect(target.port, target.host);
      for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); }
      client.pipe(upstream).pipe(client);
    });
    server.listen(port, '127.0.0.1', () => { port = (server!.address() as net.AddressInfo).port; resolve(); });
  });
  await open();
  return {
    get port() { return port; },
    open,
    async cut() {
      await new Promise<void>(resolve => { server!.close(() => resolve()); for (const socket of sockets) socket.destroy(); });
    },
  };
}

test('A database outage answers 503 with Retry-After, logs the cause, and recovers without a restart', async () => {
  await operatorFixture(async (databaseUrl, pool) => {
    const target = new URL(databaseUrl);
    const link = await relay({ host: target.hostname, port: Number(target.port || 5432) });
    const relayed = new URL(databaseUrl); relayed.hostname = '127.0.0.1'; relayed.port = String(link.port);
    const sink = createMemorySink();
    const app = await startProjectOpsPostgresApp({ databaseUrl: relayed.toString(), host: '127.0.0.1', port: 0,
      clock: () => '2026-10-14T10:00:00.000Z', logger: createLogger({ sink }) });
    try {
      await new ProjectOpsOperatorStore(pool).provision('operator', 'outage-acceptance-password');
      const origin = app.server.origin;
      const login = await fetch(origin + '/projectops/access/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ login: 'operator', password: 'outage-acceptance-password' }) });
      assert.equal(login.status, 200);
      const headers = { origin, cookie: login.headers.get('set-cookie')!.split(';')[0]!, 'content-type': 'application/json', 'x-csrf-token': (await login.json()).csrfToken };
      const get = (path: string) => fetch(origin + path, { headers });
      assert.equal((await get('/projectops/clients')).status, 200);

      await link.cut();
      for (const path of ['/projectops/clients?q=rania', '/projectops/project-requests', '/projectops/dashboard']) {
        const response = await get(path);
        const body = await response.json();
        assert.equal(response.status, 503, `${path}: ${JSON.stringify(body)}`);
        assert.equal(response.headers.get('retry-after'), '5');
        assert.equal(body.code, 'SERVICE_UNAVAILABLE');
        assert.doesNotMatch(JSON.stringify(body), /ECONNREFUSED|Connection terminated|127\.0\.0\.1|postgres/i, 'the response hides the cause');
      }
      const write = await fetch(origin + '/projectops/clients', { method: 'POST', headers, body: JSON.stringify({ id: 'c-outage', name: 'Outage' }) });
      assert.equal(write.status, 503);
      const ready = await fetch(origin + '/health/ready');
      assert.equal(ready.status, 503);

      const failures = sink.records.filter(record => record.message === 'http.request.failed');
      assert.ok(failures.length >= 4, `expected a failure record per request, got ${failures.length}`);
      for (const record of failures.filter(r => String(r.context.path).startsWith('/projectops'))) {
        assert.equal(record.level, 'error');
        assert.equal(record.context.status, 503);
        assert.match(String(record.context.method), /^(GET|POST)$/);
        const chain = JSON.stringify(record.context.error);
        assert.match(chain, /ECONNREFUSED|Connection terminated|timeout exceeded/, 'the log names the database failure');
      }
      assert.ok(failures.some(r => r.context.path === '/projectops/clients'), 'the path is logged without its query');
      assert.doesNotMatch(JSON.stringify(sink.records), /rania|outage-acceptance-password/);

      await link.open();
      const recovered = await get('/projectops/clients');
      assert.equal(recovered.status, 200, 'the pool reconnects once the database is back');
      assert.equal((await fetch(origin + '/health/ready')).status, 200);
    } finally {
      await link.cut().catch(() => {});
      await app.close();
    }
  });
});
