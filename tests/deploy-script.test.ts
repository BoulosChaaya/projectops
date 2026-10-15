import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploy } from '../scripts/projectops-deploy.mjs';

const HOOK = 'https://api.render.com/deploy/srv-abc?key=super-secret-key';
const ORIGIN = 'https://projectops.onrender.com';
const NEW = 'a'.repeat(40), OLD = 'b'.repeat(40);

/** A fake Render: the hook answers from `hookStatuses`; /health/live reports OLD until `liveAfter` polls. */
function render({ hookStatuses = [200], liveAfter = 2, live = NEW }: { hookStatuses?: number[]; liveAfter?: number; live?: string } = {}) {
  const calls: string[] = [];
  let polls = 0, clock = 0;
  const fetch = async (url: URL | RequestInfo) => {
    const target = new URL(url instanceof Request ? url.url : url);
    calls.push(target.href);
    if (target.pathname.startsWith('/deploy/')) return new Response('{}', { status: hookStatuses.shift() ?? 200 });
    polls++;
    return Response.json({ ok: true, details: { commit: polls > liveAfter ? live : OLD } });
  };
  return { calls, fetch, sleep: async (ms: number) => { clock += ms; }, now: () => clock };
}

test('Deploys exactly the given commit and waits until the service reports it', async () => {
  const fake = render();
  assert.deepEqual(await deploy({ hookUrl: HOOK, origin: ORIGIN, commit: NEW, ...fake } as Parameters<typeof deploy>[0]), { commit: NEW });
  const hook = new URL(fake.calls[0]!);
  assert.equal(hook.searchParams.get('ref'), NEW, 'the hook names the commit, not "whatever main is"');
  assert.equal(hook.searchParams.get('key'), 'super-secret-key', 'the hook key is kept');
  assert.equal(fake.calls.filter(call => call.endsWith('/health/live')).length, 3);
});

test('A busy Render (202) is asked again; the deploy only counts once it started', async () => {
  const fake = render({ hookStatuses: [202, 202, 200] });
  await deploy({ hookUrl: HOOK, origin: ORIGIN, commit: NEW, ...fake } as Parameters<typeof deploy>[0]);
  assert.equal(fake.calls.filter(call => call.includes('/deploy/')).length, 3);
});

test('Failures are explicit and never print the secret hook URL', async () => {
  const failures: [Record<string, unknown>, RegExp][] = [
    [{ hookUrl: undefined }, /not set/],
    [{ hookUrl: 'http://api.render.com/deploy/x?key=super-secret-key' }, /https/],
    [{ commit: 'main' }, /full Git SHA/],
    [{ ...render({ hookStatuses: [404] }) }, /answered 404/],
    [{ ...render({ live: OLD }), timeoutMs: 60_000 }, new RegExp(`runs ${OLD}, expected ${NEW}`)],
    [{ ...render({ hookStatuses: Array(100).fill(202) }), timeoutMs: 60_000 }, /stayed in progress/],
  ];
  for (const [override, message] of failures) {
    const options = { hookUrl: HOOK, origin: ORIGIN, commit: NEW, ...render(), ...override };
    await assert.rejects(deploy(options as Parameters<typeof deploy>[0]), (error: Error) => {
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /super-secret-key/);
      return true;
    });
  }
});
