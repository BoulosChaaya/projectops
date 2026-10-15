import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A minimal built-client directory, so server tests do not depend on running `pnpm build`. */
export async function clientFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'projectops-client-'));
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><script type="module" src="/projectops/assets/app-abc123.js"></script></head><body><div id="root"></div></body></html>');
  await writeFile(path.join(directory, 'assets', 'app-abc123.js'), 'console.log("client");');
  await writeFile(path.join(directory, 'assets', 'app-abc123.css'), 'body{margin:0}');
  await writeFile(path.join(directory, 'assets', 'font-abc123.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  await writeFile(path.join(directory, 'secret.txt'), 'outside assets');
  return directory;
}
