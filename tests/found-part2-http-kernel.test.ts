// Verification Suite for EXEC-FOUND-034..060 (HTTP Kernel & Request-Serving System)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import { createMemorySink } from '../packages/logger/src/sink.ts';
import { createLogger } from '../packages/logger/src/index.ts';
import { isValidErrorResponse } from '../packages/http-contracts/src/error-response.ts';
import { parseHeaders } from '../apps/api/src/http/headers.ts';
import { parseBody } from '../apps/api/src/http/body.ts';
import { routeRequest } from '../apps/api/src/http/routing.ts';
import { negotiateContentType } from '../apps/api/src/http/content-negotiation.ts';
import { serializeResponse } from '../apps/api/src/http/response.ts';
import { normalizeError } from '../apps/api/src/http/errors/normalize.ts';
import { HttpError } from '../apps/api/src/http/errors/classify.ts';
import { validateInput } from '../apps/api/src/http/validation/index.ts';
import { assertNoCrossRequestState } from '../apps/api/src/http/request-context/leak-prevention.ts';
import { getCurrentRequestContext } from '../apps/api/src/http/request-context/context.ts';
import { startHttpListener } from '../apps/api/src/bootstrap/http-listener.ts';

unitTest('EXEC-FOUND-039..041: Header case-insensitivity, body parsing, size limits, and malformed JSON rejection', async () => {
  const headers = parseHeaders({ 'Content-Type': 'application/json', 'X-Custom': ['a', 'b'] });
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('X-CUSTOM'), 'a, b');
  assert.deepEqual(headers.getAll('x-custom'), ['a', 'b']);

  const parsed = await parseBody('{"hello":"uruk"}', 'application/json; charset=utf-8');
  assert.deepEqual(parsed, { hello: 'uruk' });

  await assert.rejects(
    () => parseBody('{bad-json', 'application/json'),
    (err: HttpError) => err.status === 400 && err.code === 'MALFORMED_JSON_BODY'
  );

  await assert.rejects(
    () => parseBody('1234567890', 'text/plain', 5),
    (err: HttpError) => err.status === 413 && err.code === 'PAYLOAD_TOO_LARGE'
  );
});

unitTest('EXEC-FOUND-042..045: Static vs parameterized route matching and 404/405 error classification', () => {
  const routes = [
    { method: 'GET', path: '/items/:id', handler: 'param-handler' },
    { method: 'GET', path: '/items/featured', handler: 'static-handler' },
    { method: 'POST', path: '/items', handler: 'create-handler' },
  ];

  // Static route must win over :id param route
  const staticMatch = routeRequest({ method: 'GET', path: '/items/featured' }, routes);
  assert.equal(staticMatch.route.handler, 'static-handler');

  const paramMatch = routeRequest({ method: 'GET', path: '/items/42' }, routes);
  assert.equal(paramMatch.route.handler, 'param-handler');
  assert.deepEqual(paramMatch.params, { id: '42' });

  // Wrong method on existing path -> 405
  assert.throws(
    () => routeRequest({ method: 'DELETE', path: '/items' }, routes),
    (err: HttpError) => err.status === 405 && err.code === 'METHOD_NOT_ALLOWED'
  );

  // Unknown path -> 404
  assert.throws(
    () => routeRequest({ method: 'GET', path: '/unknown' }, routes),
    (err: HttpError) => err.status === 404 && err.code === 'ROUTE_NOT_FOUND'
  );
});

unitTest('EXEC-FOUND-046..051: Content negotiation, response serialization, and safe error normalization', () => {
  assert.equal(negotiateContentType('application/json'), 'application/json');
  assert.equal(negotiateContentType('text/plain, application/json'), 'text/plain');
  assert.throws(
    () => negotiateContentType('application/xml'),
    (err: HttpError) => err.status === 406 && err.code === 'NOT_ACCEPTABLE'
  );

  const res = serializeResponse({ ok: true }, { correlationId: 'corr-1' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-correlation-id'], 'corr-1');

  // Unexpected internal error must never leak stack or sensitive message
  const internalErr = new Error('SELECT * FROM users WHERE secret="leaked"');
  const norm500 = normalizeError(internalErr, 'corr-500');
  assert.equal(isValidErrorResponse(norm500), true);
  assert.equal(norm500.status, 500);
  assert.equal(JSON.stringify(norm500).includes('leaked'), false);
});

unitTest('EXEC-FOUND-052..055: Boundary input validation rejects invalid types/ranges without leaking raw secret input', () => {
  const schema = {
    username: { type: 'string' as const, minLength: 3, maxLength: 20 },
    age: { type: 'integer' as const, min: 18, max: 120 },
    role: { type: 'string' as const, enum: ['admin', 'member'] },
  };

  const valid = validateInput(schema, { username: 'gilgamesh', age: 30, role: 'admin' });
  assert.deepEqual(valid, { username: 'gilgamesh', age: 30, role: 'admin' });

  assert.throws(
    () =>
      validateInput(schema, {
        username: 'ab_secret_value',
        age: 12,
        role: 'superuser',
      }),
    (err: HttpError) => {
      const serialized = JSON.stringify(normalizeError(err));
      assert.equal(err.status, 400);
      assert.equal(err.code, 'VALIDATION_FAILED');
      assert.equal(serialized.includes('ab_secret_value'), false);
      return true;
    }
  );
});

unitTest('EXEC-FOUND-034..037 & 056..060: End-to-End Request-Serving System, Context Isolation, Timeouts & Concurrency', async () => {
  const sink = createMemorySink();
  const logger = createLogger({ minLevel: 'info', sink });

  const server = await startHttpListener({
    port: 0,
    maxConcurrentRequests: 4,
    requestTimeoutMs: 80,
    maxBodyBytes: 1024,
    logger,
    routes: [
      {
        method: 'POST',
        path: '/orders/:orderId',
        handler: async (req, ctx, params) => {
          ctx.set('sentinel', params.orderId);
          await new Promise((r) => setTimeout(r, 15));
          // Prove AsyncLocalStorage context never leaks across overlapping requests
          assertNoCrossRequestState(ctx.requestId);
          assert.equal(getCurrentRequestContext()?.get('sentinel'), params.orderId);

          const body = validateInput<{ quantity: number }>(
            { quantity: { type: 'integer', min: 1, max: 100 } },
            req.body
          );

          return {
            orderId: params.orderId,
            quantity: body.quantity,
            correlationId: ctx.correlationId,
          };
        },
      },
      {
        method: 'GET',
        path: '/slow',
        handler: async () => {
          await new Promise((r) => setTimeout(r, 250));
          return { ok: true };
        },
      },
    ],
  });

  try {
    // 1. Readiness check
    const readyRes = await fetch(`${server.origin}/health/ready`);
    assert.equal(readyRes.status, 200);

    // 2. Overlapping concurrent requests to prove context isolation (EXEC-FOUND-058 & 059)
    const [r1, r2] = await Promise.all([
      fetch(`${server.origin}/orders/ord-101`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-alpha' },
        body: JSON.stringify({ quantity: 5 }),
      }),
      fetch(`${server.origin}/orders/ord-202`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-beta' },
        body: JSON.stringify({ quantity: 10 }),
      }),
    ]);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.deepEqual(await r1.json(), {
      orderId: 'ord-101',
      quantity: 5,
      correlationId: 'corr-alpha',
    });
    assert.deepEqual(await r2.json(), {
      orderId: 'ord-202',
      quantity: 10,
      correlationId: 'corr-beta',
    });

    // 3. Invalid input returns canonical 400 validation error
    const invalidRes = await fetch(`${server.origin}/orders/ord-303`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 999 }),
    });
    assert.equal(invalidRes.status, 400);
    const invalidBody = await invalidRes.json();
    assert.equal(isValidErrorResponse(invalidBody), true);
    assert.equal(invalidBody.code, 'VALIDATION_FAILED');

    // 4. Slow route exceeding timeout deadline terminates with 408 (EXEC-FOUND-037)
    const slowRes = await fetch(`${server.origin}/slow`);
    assert.equal(slowRes.status, 408);

    // 5. Verify log correlation recorded in structured sink
    assert.equal(
      sink.records.some((rec) => rec.context.correlationId === 'corr-alpha'),
      true
    );
  } finally {
    await server.close();
  }
});
