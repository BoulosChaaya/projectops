import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function banner(title) {
  console.log(`\n${'='.repeat(80)}\n[PROJECTOPS VERIFY] ${title}\n${'='.repeat(80)}`);
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' });
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')}`);
}

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else output.push(full);
  }
  return output.sort();
}

function assertMissing(relativePath) {
  if (fs.existsSync(path.join(ROOT, relativePath))) {
    fail(`Removed artifact is still present: ${relativePath}`);
  }
}

banner('1. Project hygiene');
for (const relativePath of [
  '__pycache__',
  'gen_exec_fixed.py',
  'SHA256SUMS',
  'CANONICAL-V2-FREEZE.md',
  'V2.8-CORRECTION-RECEIPT.md',
  'V2.8-CORRECTION-2-REVERIFICATION.md',
  'docs/execution-graph/source',
]) {
  assertMissing(relativePath);
}

const allFiles = walk(ROOT).map((file) => path.relative(ROOT, file).replaceAll(path.sep, '/'));
const disguisedYaml = allFiles.filter((file) => {
  if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return false;
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return text.includes('export const') || text.trimStart().startsWith('//');
});
if (disguisedYaml.length > 0) {
  fail(`YAML files contain TypeScript content: ${disguisedYaml.join(', ')}`);
}

const workspacePackages = ['apps/api', 'apps/gateway', 'apps/web', 'apps/worker'];
for (const dir of fs.readdirSync(path.join(ROOT, 'packages')).sort()) {
  workspacePackages.push(`packages/${dir}`);
}
for (const pkgDir of workspacePackages) {
  if (!fs.existsSync(path.join(ROOT, pkgDir, 'package.json'))) {
    fail(`Workspace package is missing package.json: ${pkgDir}`);
  }
}
console.log(`  [PASS] Hygiene checks passed for ${allFiles.length} files.`);

banner('2. Native TypeScript test suites');
run('node', ['--experimental-strip-types', '--test', 'tests/*.test.ts']);

console.log('\n[PROJECTOPS VERIFY: PASS]');
