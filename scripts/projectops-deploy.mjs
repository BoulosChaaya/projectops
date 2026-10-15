import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Deploys one commit to Render and waits until the live service runs it. CI calls this after the
// checks on main pass, so every deploy is a visible, pass-or-fail step in GitHub, and nothing else
// (manual workflow runs, check events) starts or blocks a deploy.
//
// The hook URL is a secret: it never appears in output, including error messages.

const COMMIT = /^[0-9a-f]{40}$/;

export async function deploy({
  hookUrl, origin, commit,
  fetch = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
  log = () => {},
  timeoutMs = 20 * 60_000,
  pollMs = 15_000,
  busyRetryMs = 30_000,
}) {
  if (!hookUrl) throw Error('RENDER_DEPLOY_HOOK_URL is not set.');
  let hook;
  try { hook = new URL(hookUrl); } catch { throw Error('RENDER_DEPLOY_HOOK_URL is not a valid URL.'); }
  if (hook.protocol !== 'https:') throw Error('RENDER_DEPLOY_HOOK_URL must be an https URL.');
  let live;
  try { live = new URL('/health/live', origin); } catch { throw Error('PROJECTOPS_ORIGIN is not a valid URL.'); }
  if (!COMMIT.test(commit ?? '')) throw Error('The commit to deploy must be a full Git SHA.');
  // Deploy exactly this commit, not whatever main points at by the time Render builds.
  hook.searchParams.set('ref', commit);
  const deadline = now() + timeoutMs;

  // 200 starts the deploy. 202 means another deploy is in progress and this request did not start
  // one, so ask again once it may have finished.
  for (;;) {
    let response;
    try { response = await fetch(hook, { method: 'POST' }); }
    catch { throw Error('Could not reach the Render deploy hook.'); }
    if (response.status === 200) { log(`Deploy of ${commit} started.`); break; }
    if (response.status !== 202) throw Error(`The Render deploy hook answered ${response.status}.`);
    if (now() + busyRetryMs > deadline) throw Error('Another Render deploy stayed in progress; this commit was not deployed.');
    log('Another deploy is in progress; asking again shortly.');
    await sleep(busyRetryMs);
  }

  // The service reports the commit it runs; done when the new instance serves traffic.
  let seen = 'unknown';
  for (;;) {
    try {
      const response = await fetch(live, { headers: { accept: 'application/json' } });
      if (response.ok) seen = (await response.json())?.details?.commit ?? 'unknown';
    } catch { /* the service may be briefly unreachable; keep waiting */ }
    if (seen === commit) { log(`Live: ${live.origin} runs ${commit}.`); return { commit }; }
    if (now() + pollMs > deadline) throw Error(`Deploy did not go live in time: the service runs ${seen}, expected ${commit}.`);
    await sleep(pollMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await deploy({ hookUrl: process.env.RENDER_DEPLOY_HOOK_URL, origin: process.env.PROJECTOPS_ORIGIN,
      commit: process.env.GITHUB_SHA, log: line => console.log(line) });
  } catch (error) {
    console.error('Deploy failed: ' + (error instanceof Error ? error.message : 'unknown error'));
    process.exitCode = 1;
  }
}
