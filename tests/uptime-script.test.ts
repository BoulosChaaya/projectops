import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkUptime } from '../scripts/projectops-uptime.mjs';

const ORIGIN = 'https://projectops.onrender.com';
const SHA = 'a'.repeat(40);
type Answer = Response | Error;
type Site = Record<string, () => Answer>;

const healthy: Site = {
  '/health/live': () => Response.json({ ok: true, status: 'healthy', details: { commit: SHA } }),
  '/health/ready': () => Response.json({ ok: true, status: 'healthy' }),
  '/projectops/login': () => new Response('<!doctype html><title>ProjectOps</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
};

/** A fake live service: each round asks every path once; `rounds[i]` overrides answers in round i. */
function site(rounds: Partial<Site>[] = []) {
  const calls: string[] = [], waits: number[] = [];
  const fetch = async (url: URL | RequestInfo) => {
    const target = new URL(url instanceof Request ? url.url : url);
    calls.push(target.pathname);
    const round = calls.filter(call => call === '/health/live').length - 1;
    const answer = (rounds[round]?.[target.pathname] ?? healthy[target.pathname])?.() ?? new Response('', { status: 404 });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, waits, fetch, sleep: async (ms: number) => { waits.push(ms); } };
}
const run = (fake: ReturnType<typeof site>, extra: object = {}) =>
  checkUptime({ origin: ORIGIN, ...fake, ...extra } as Parameters<typeof checkUptime>[0]);

test('A healthy service passes in one round of three checks', async () => {
  const fake = site(), lines: string[] = [];
  assert.deepEqual(await run(fake, { log: (line: string) => lines.push(line) }), { commit: SHA });
  assert.deepEqual(fake.calls, ['/health/live', '/health/ready', '/projectops/login']);
  assert.deepEqual(fake.waits, []);
  assert.deepEqual(lines, [`Up: ${ORIGIN} runs ${SHA}; database ready; sign-in page served.`]);
});

test('One failed round is retried a minute later, so a dropped request is not an outage', async () => {
  const fake = site([{ '/health/ready': () => new TypeError('fetch failed') }]);
  assert.deepEqual(await run(fake), { commit: SHA });
  assert.deepEqual(fake.waits, [60_000]);
  assert.equal(fake.calls.length, 5, 'live and ready, then the full second round');
});

test('A lasting failure fails, naming the check and what it answered', async () => {
  const down = (answer: () => Answer): Partial<Site>[] => [{ '/health/ready': answer }, { '/health/ready': answer }];
  const cases: [Partial<Site>[], RegExp][] = [
    // The process is up but its database is not (ready answers 503).
    [down(() => Response.json({ ok: false }, { status: 503 })), /\/health\/ready: answered 503, expected 200\./],
    [down(() => new TypeError('fetch failed')), /\/health\/ready: no answer \(unreachable\)\./],
    [down(() => new DOMException('timed out', 'TimeoutError')), /\/health\/ready: no answer \(timed out after 10 s\)\./],
    [down(() => Response.json({ ok: false })), /\/health\/ready: did not report ok\./],
    [down(() => new Response('<html>', { status: 200 })), /\/health\/ready: did not report ok\./],
  ];
  const everyRound = (paths: Partial<Site>): Partial<Site>[] => [paths, paths];
  cases.push(
    [everyRound({ '/health/live': () => new Response('Bad Gateway', { status: 502 }) }), /\/health\/live: answered 502/],
    // Render's own error page or an old build: the process answers but not as this application.
    [everyRound({ '/health/live': () => Response.json({ ok: true }) }), /\/health\/live: does not report the running commit\./],
    [everyRound({ '/projectops/login': () => new Response('', { status: 500 }) }), /\/projectops\/login: answered 500/],
    [everyRound({ '/projectops/login': () => new Response('', { status: 302, headers: { location: '/elsewhere' } }) }), /\/projectops\/login: answered 302/],
    [everyRound({ '/projectops/login': () => Response.json({ error: 'x' }) }), /\/projectops\/login: is not an HTML page\./],
  );
  for (const [rounds, message] of cases) {
    const fake = site(rounds);
    await assert.rejects(run(fake), (error: Error) => {
      assert.match(error.message, /^Down after 2 checks, 60 s apart\. Last failure: /);
      assert.match(error.message, message);
      return true;
    });
    assert.deepEqual(fake.waits, [60_000]);
  }
});

test('The origin must be a valid https URL, and only the origin is used', async () => {
  for (const origin of [undefined, '', 'not a url']) await assert.rejects(run(site(), { origin }), /PROJECTOPS_ORIGIN is not a valid URL/);
  await assert.rejects(run(site(), { origin: 'http://projectops.onrender.com' }), /must be an https origin/);
  const fake = site();
  await run(fake, { origin: ORIGIN + '/projectops?x=1' });
  assert.deepEqual(fake.calls, ['/health/live', '/health/ready', '/projectops/login']);
});

test('The uptime workflow runs the check every 15 minutes, read-only, with pinned Actions', () => {
  const workflow = readFileSync('.github/workflows/uptime.yml', 'utf8');
  assert.match(workflow, /- cron: '7,22,37,52 \* \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/, 'can also be run by hand');
  assert.match(workflow, /permissions:\n {2}contents: read\n\n/, 'read-only token');
  assert.doesNotMatch(workflow, /secrets\./, 'needs no secret');
  assert.match(workflow, /PROJECTOPS_ORIGIN: \$\{\{ vars\.PROJECTOPS_ORIGIN \}\}/);
  assert.match(workflow, /run: node scripts\/projectops-uptime\.mjs\n/);
  for (const [, action] of workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) assert.match(action!, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
});
