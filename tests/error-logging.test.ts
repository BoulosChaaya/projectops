import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHttpListener, requestPath } from '../apps/api/src/bootstrap/http-listener.ts';
import { HttpError, classifyHttpError } from '../apps/api/src/http/errors/classify.ts';
import { createLogger, describeError, redactSecrets } from '../packages/logger/src/index.ts';
import { createMemorySink } from '../packages/logger/src/sink.ts';
import { isDatabaseUnavailableError } from '../packages/db/src/connection/unavailable.ts';
import { DatabaseConnectTimeoutError } from '../packages/db/src/connection/timeout.ts';

const withCode = (message: string, code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

// Shapes recorded from pg 8.23 against PostgreSQL 16 by stopping the server around live queries.
const outages: [string, unknown][] = [
  ['refused before connecting', withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')],
  ['server stopped mid-session', Object.assign(withCode('terminating connection due to administrator command', '57P01'), { name: 'error' })],
  ['pool connect timeout', new Error('timeout exceeded when trying to connect')],
  ['socket dropped', new Error('Connection terminated unexpectedly')],
  ['dual-stack refusal', new AggregateError([withCode('connect ECONNREFUSED ::1:5432', 'ECONNREFUSED'), withCode('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED')])],
  ['too many connections', withCode('sorry, too many clients already', '53300')],
  ['connection exception class', withCode('connection failure', '08006')],
  ['wrapped in a cause', new Error('query failed', { cause: withCode('connect ECONNREFUSED', 'ECONNREFUSED') })],
  ['package connect deadline', new DatabaseConnectTimeoutError(5000)],
];
const notOutages: [string, unknown][] = [
  ['missing table', withCode('relation "missing" does not exist', '42P01')],
  ['unique violation', withCode('duplicate key value', '23505')],
  ['statement timeout', withCode('canceling statement due to statement timeout', '57014')],
  ['plain bug', new TypeError("Cannot read properties of undefined (reading 'id')")],
  ['thrown string', 'boom'],
  ['null', null],
];

test('Database outages are told apart from query errors and bugs', () => {
  for (const [label, error] of outages) assert.equal(isDatabaseUnavailableError(error), true, label);
  for (const [label, error] of notOutages) assert.equal(isDatabaseUnavailableError(error), false, label);
  const loop: { cause?: unknown } = new Error('self-referencing');
  loop.cause = loop;
  assert.equal(isDatabaseUnavailableError(loop), false, 'a cause cycle terminates');
});

test('Outages classify as 503 SERVICE_UNAVAILABLE; other server errors stay 500 and client errors are untouched', () => {
  for (const [label, error] of outages) {
    assert.deepEqual({ ...classifyHttpError(error) }, { kind: 'server', status: 503, code: 'SERVICE_UNAVAILABLE',
      message: 'The service is temporarily unavailable. Try again shortly.' }, label);
  }
  for (const [label, error] of notOutages) assert.equal(classifyHttpError(error).status, 500, label);
  assert.equal(classifyHttpError(new HttpError(404, 'NOT_FOUND', 'Missing.')).status, 404);
});

test('Error descriptions keep diagnostics, drop row data and redact credentials', () => {
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "projectops_clients_pkey"'), {
    name: 'error', code: '23505', severity: 'ERROR', table: 'projectops_clients', constraint: 'projectops_clients_pkey',
    detail: 'Key (id)=(client-of-rania@cedar.test) already exists.', where: 'SQL statement "INSERT ..."', parameters: ['secret-row'],
  });
  const described = describeError(new Error('save failed', { cause: pgError }));
  assert.equal(described.message, 'save failed');
  assert.match(String(described.stack), /error-logging\.test\.ts/);
  const cause = described.cause as Record<string, unknown>;
  assert.deepEqual({ ...cause, stack: undefined }, { name: 'error', message: pgError.message, code: '23505', severity: 'ERROR',
    table: 'projectops_clients', constraint: 'projectops_clients_pkey', stack: undefined });
  assert.doesNotMatch(JSON.stringify(described), /rania|secret-row|INSERT/);

  assert.equal(redactSecrets('connect to postgres://ops:hunter2@db.internal:5432/projectops failed'),
    'connect to postgres://[Redacted]@db.internal:5432/projectops failed');
  assert.equal(redactSecrets("host=db password='hunter 2' user=ops"), 'host=db password=[Redacted] user=ops');
  assert.doesNotMatch(JSON.stringify(describeError(new Error('bad postgresql://u:p@h/d', { cause: new Error('password=pw1') }))), /u:p@|pw1/);

  assert.deepEqual(describeError('boom'), { name: 'string', message: 'boom' });
  let deep: Error = new Error('level 0');
  for (let i = 1; i <= 10; i++) deep = new Error(`level ${i}`, { cause: deep });
  assert.equal((JSON.stringify(describeError(deep)).match(/"message"/g) ?? []).length, 4, 'cause chain is bounded');
  assert.equal(describeError(new Error('x'.repeat(2000))).message.length, 501);
});

test('Request paths are logged without their query string', () => {
  assert.equal(requestPath('/projectops/clients?q=rania%40cedar.test&limit=5'), '/projectops/clients');
  assert.equal(requestPath('/projectops/clients#x'), '/projectops/clients');
  assert.equal(requestPath(undefined), '/');
  assert.equal(requestPath('/' + 'a'.repeat(2000)).length, 513);
});

test('The listener logs server errors with their cause, client errors without, and answers outages with 503 and Retry-After', async () => {
  const sink = createMemorySink();
  const server = await startHttpListener({
    logger: createLogger({ sink, clock: () => '2026-10-14T00:00:00.000Z' }),
    routes: [
      { method: 'GET', path: '/bug', handler: () => { throw new TypeError('Cannot read properties of undefined (reading \'id\')'); } },
      { method: 'GET', path: '/down', handler: () => { throw new Error('query failed', { cause: withCode('connect ECONNREFUSED 10.0.0.5:5432', 'ECONNREFUSED') }); } },
      { method: 'GET', path: '/leak', handler: () => { throw new Error('could not use postgres://ops:hunter2@db/projectops'); } },
      { method: 'GET', path: '/missing', handler: () => { throw new HttpError(404, 'NOT_FOUND', 'Missing.'); } },
      { method: 'GET', path: '/not-ready', handler: () => { throw new HttpError(503, 'SERVICE_NOT_READY', 'Not ready.'); } },
    ],
  });
  try {
    const call = async (path: string) => {
      const response = await fetch(server.origin + path, { headers: { 'x-correlation-id': `corr-${path.split('?')[0]!.slice(1)}` } });
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() };
    };
    const bug = await call('/bug?q=rania%40cedar.test');
    assert.deepEqual([bug.status, bug.body.code, bug.retryAfter], [500, 'INTERNAL_SERVER_ERROR', null]);
    assert.doesNotMatch(JSON.stringify(bug.body), /Cannot read|TypeError/, 'the response still hides the cause');
    const down = await call('/down');
    assert.deepEqual([down.status, down.body.code, down.retryAfter], [503, 'SERVICE_UNAVAILABLE', '5']);
    assert.doesNotMatch(JSON.stringify(down.body), /ECONNREFUSED|10\.0\.0\.5/);
    await call('/leak');
    const notReady = await call('/not-ready');
    assert.deepEqual([notReady.status, notReady.retryAfter], [503, '5']);
    const missing = await call('/missing');
    assert.equal(missing.status, 404);

    const records = sink.records.filter(record => record.message.startsWith('http.request.'));
    const byPath = (path: string) => records.find(record => record.context.path === path)!;
    const bugLog = byPath('/bug');
    assert.equal(bugLog.level, 'error');
    assert.equal(bugLog.message, 'http.request.failed');
    assert.deepEqual({ ...bugLog.context, error: undefined }, { correlationId: 'corr-bug', method: 'GET', path: '/bug',
      code: 'INTERNAL_SERVER_ERROR', status: 500, error: undefined });
    const bugError = bugLog.context.error as Record<string, unknown>;
    assert.equal(bugError.name, 'TypeError');
    assert.match(String(bugError.message), /reading 'id'/);
    assert.match(String(bugError.stack), /error-logging\.test\.ts/, 'the stack points at the failing handler');
    assert.doesNotMatch(JSON.stringify(records), /rania/, 'query strings are not logged');

    const downLog = byPath('/down');
    assert.deepEqual([downLog.level, downLog.context.status, (downLog.context.error as { cause: { code: string } }).cause.code], ['error', 503, 'ECONNREFUSED']);
    assert.doesNotMatch(JSON.stringify(byPath('/leak')), /hunter2/);
    const notReadyLog = byPath('/not-ready');
    assert.deepEqual([notReadyLog.level, notReadyLog.context.code, 'error' in notReadyLog.context], ['error', 'SERVICE_NOT_READY', false],
      'a deliberate server error is described by its code, without a stack');
    const missingLog = byPath('/missing');
    assert.deepEqual([missingLog.level, missingLog.message, 'error' in missingLog.context], ['warn', 'http.request.error', false]);
  } finally {
    await server.close();
  }
});
