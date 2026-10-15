import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export async function createRuntimeRelease({ root, destination = path.join(tmpdir(), 'projectops-release-' + randomUUID()), checkpoint }) {
  root = await realpath(root);
  if (!/^[a-f0-9]{40}$/.test(checkpoint)) throw Error('A release checkpoint is required.');
  destination = path.join(await realpath(path.dirname(path.resolve(destination))), path.basename(destination));
  if (destination.startsWith(root + path.sep) || destination === root) throw Error('Release must be outside the checkout.');
  await mkdir(destination, { mode: 0o700 }); // Refuse an existing directory rather than overwrite it.
  const files = [];
  async function copy(relative) {
    const source = path.join(root, relative), info = await lstat(source);
    if (info.isSymbolicLink()) throw Error('Release source symlinks are not supported.');
    if (info.isDirectory()) {
      for (const name of (await readdir(source)).sort()) {
        // Build output is excluded, except the built web client, which the server serves at runtime.
        const builtClient = name === 'dist' && relative === path.join('apps', 'client');
        if (['node_modules', 'coverage', '.git'].includes(name) || (name === 'dist' && !builtClient) || name.startsWith('.env')) continue;
        await copy(path.join(relative, name));
      }
    } else if (info.isFile()) {
      const content = await readFile(source), target = path.join(destination, relative);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { flag: 'wx', mode: 0o600 });
      files.push({ path: relative.split(path.sep).join('/'), sha256: createHash('sha256').update(content).digest('hex') });
    }
  }
  for (const entry of ['apps', 'packages', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/projectops-render-start.mjs', 'render.yaml']) await copy(entry);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifest = { format: 'projectops.source-runtime', version: 1, checkpoint, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
  await writeFile(path.join(destination, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { destination, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let input = ''; for await (const part of process.stdin) { input += part; if (input.length > 8192) throw Error('Input too large.'); }
    const result = await createRuntimeRelease({ ...JSON.parse(input), root: fileURLToPath(new URL('../', import.meta.url)) });
    console.log(JSON.stringify({ destination: result.destination, checkpoint: result.manifest.checkpoint, sha256: result.manifest.sha256 }));
  } catch { console.error('ProjectOps release packaging failed. Check private destination and checkpoint.'); process.exitCode = 1; }
}
