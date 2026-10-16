import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Checks that the live service is up, from outside it. A scheduled GitHub workflow runs this every
// 15 minutes; a failed run is GitHub's alert (it emails the account that owns the workflow).
//
// One round asks three things, each a different way the site can be down for a visitor:
//   /health/live      the process answers and reports the commit it runs
//   /health/ready     its database answers too
//   /projectops/login the sign-in page is served (the client build is present)
// A failed round is tried again after a pause, so one dropped request is not reported as an outage.

const COMMIT = /^[0-9a-f]{40}$/;

export async function checkUptime({
  origin,
  fetch = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = () => {},
  rounds = 2,
  retryMs = 60_000,
  requestTimeoutMs = 10_000,
}) {
  let base;
  try { base = new URL(origin ?? ''); } catch { throw Error('PROJECTOPS_ORIGIN is not a valid URL.'); }
  if (base.protocol !== 'https:') throw Error('PROJECTOPS_ORIGIN must be an https origin.');

  const get = async (pathname, accept) => {
    try {
      return await fetch(new URL(pathname, base.origin), { headers: { accept }, redirect: 'manual', signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch (error) {
      throw Error(`${pathname}: no answer (${error instanceof Error && error.name === 'TimeoutError' ? `timed out after ${requestTimeoutMs / 1000} s` : 'unreachable'}).`);
    }
  };
  const json = async (pathname) => {
    const response = await get(pathname, 'application/json');
    if (response.status !== 200) throw Error(`${pathname}: answered ${response.status}, expected 200.`);
    const body = await response.json().catch(() => null);
    if (body?.ok !== true) throw Error(`${pathname}: did not report ok.`);
    return body;
  };

  const round = async () => {
    const commit = (await json('/health/live'))?.details?.commit;
    if (!COMMIT.test(commit ?? '')) throw Error('/health/live: does not report the running commit.');
    await json('/health/ready');
    const login = await get('/projectops/login', 'text/html');
    if (login.status !== 200) throw Error(`/projectops/login: answered ${login.status}, expected 200.`);
    if (!/^text\/html\b/.test(login.headers.get('content-type') ?? '')) throw Error('/projectops/login: is not an HTML page.');
    await login.body?.cancel();
    return commit;
  };

  for (let attempt = 1; ; attempt++) {
    try {
      const commit = await round();
      log(`Up: ${base.origin} runs ${commit}; database ready; sign-in page served.`);
      return { commit };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      if (attempt >= rounds) throw Error(`Down after ${rounds} checks, ${retryMs / 1000} s apart. Last failure: ${reason}`);
      log(`Check ${attempt} of ${rounds} failed (${reason}); trying again in ${retryMs / 1000} s.`);
      await sleep(retryMs);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await checkUptime({ origin: process.env.PROJECTOPS_ORIGIN, log: line => console.log(line) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Uptime check failed.');
    process.exitCode = 1;
  }
}
