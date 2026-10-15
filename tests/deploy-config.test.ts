import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readProjectOpsRuntimeConfig } from '../apps/api/src/projectops/postgres-app.ts';
import { HealthService } from '../apps/api/src/health/health.service.ts';

// The Blueprint is applied by hand in Render, so nothing else checks it. These assertions keep the
// production settings that matter tied to what CI tests: Node and PostgreSQL versions, private
// database access, deploys gated on CI, and a bounded disk.
const blueprint = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const value = (key: string) => [...blueprint.matchAll(new RegExp(`^\\s*(?:- )?${key}:\\s*"?([^"\\n#]*?)"?\\s*(?:#.*)?$`, 'gm'))].map(match => match[1]);

test('The Render Blueprint deploys the tested runtime behind CI, with a private database', () => {
  // Deploys start only from CI's deploy job, after the checks on a merged commit pass.
  assert.deepEqual(value('autoDeployTrigger'), ['off'], 'Render never deploys on its own');
  const deployJob = ci.slice(ci.indexOf('\n  deploy:'));
  assert.match(deployJob, /needs: \[verify, acceptance\]/);
  assert.match(deployJob, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(deployJob, /RENDER_DEPLOY_HOOK_URL: \$\{\{ secrets\.RENDER_DEPLOY_HOOK_URL \}\}/);
  assert.match(deployJob, /run: node scripts\/projectops-deploy\.mjs/);
  assert.match(blueprint, /key: NODE_VERSION\n\s+value: 24\.19\.0\n/);
  assert.match(ci, /node-version: 24\.19\.0/, 'CI acceptance runs the production Node version');
  assert.deepEqual(value('postgresMajorVersion'), ['16']);
  assert.match(ci, /image: postgres:16\n/, 'CI acceptance runs the production PostgreSQL major');
  assert.deepEqual(value('ipAllowList'), ['[]'], 'no public database connections');
  assert.deepEqual(value('property'), ['connectionString'], 'the private-network URL');
  const regions = value('region');
  assert.equal(regions.length, 2); assert.equal(new Set(regions).size, 1, 'service and database share a region');
  assert.deepEqual(value('diskSizeGB'), ['1']);
  assert.deepEqual(value('healthCheckPath'), ['/health/ready']);
  // Build the client with dev dependencies, then leave only production dependencies installed.
  assert.match(value('buildCommand')[0]!, /pnpm install --frozen-lockfile && corepack pnpm build && .*pnpm install --prod --frozen-lockfile --config.confirmModulesPurge=false$/);
  assert.equal(value('startCommand')[0], 'node --experimental-strip-types scripts/projectops-render-start.mjs');
});

test('The running commit is reported by liveness only when it is a full Git SHA', () => {
  const base = { DATABASE_URL: 'postgres://u@h/d' };
  const sha = 'a'.repeat(40);
  assert.equal(readProjectOpsRuntimeConfig({ ...base, RENDER_GIT_COMMIT: sha }).commit, sha);
  for (const commit of [undefined, '', 'main', 'A'.repeat(40), `${sha}<script>`]) {
    assert.equal('commit' in readProjectOpsRuntimeConfig({ ...base, RENDER_GIT_COMMIT: commit }), false, String(commit));
  }
  assert.deepEqual({ ...new HealthService([], { commit: sha }).checkLiveness() }, { ok: true, status: 'healthy', details: { commit: sha } });
  assert.deepEqual({ ...new HealthService().checkLiveness() }, { ok: true, status: 'healthy' });
});
