import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DirectHttpResponse } from '../../../api/src/http/response.ts';
import type { RouteDefinition } from '../../../api/src/http/path-matching.ts';
import type { KernelRouteHandler } from '../../../api/src/bootstrap/http-listener.ts';
import { HttpError } from '../../../api/src/http/errors/classify.ts';

/** Where `pnpm build` writes the React client (apps/client/dist). */
export const DEFAULT_CLIENT_DIR = fileURLToPath(new URL('../../../client/dist', import.meta.url));

// The built client is static and same-origin: scripts, styles and fonts load only from this
// server, and the page talks only to this server's API. Nothing is inlined, so no nonce is needed.
const SHELL_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self'",
  "connect-src 'self'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
};
// Vite's output names: a stem, a content hash and a known extension. No separators, no dot segments.
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;

export interface ClientApp {
  /** The client's index.html, for every page the React client renders. */
  shell(): Promise<DirectHttpResponse>;
  /** GET /projectops/assets/:file — the client's hashed scripts, styles and fonts. Public: they hold no data. */
  readonly assetRoute: RouteDefinition<KernelRouteHandler>;
}

export function createClientApp(directory: string = DEFAULT_CLIENT_DIR): ClientApp {
  const assets = path.join(directory, 'assets');
  let shellBody: Promise<Buffer> | undefined;
  return {
    async shell() {
      // Read once; a missing build is retried on the next request rather than cached as a failure.
      shellBody ??= readFile(path.join(directory, 'index.html')).catch(error => { shellBody = undefined; throw error; });
      let body: Buffer;
      try { body = await shellBody; }
      catch (error) { throw new HttpError(503, 'CLIENT_NOT_BUILT', 'The ProjectOps web client is not built.', undefined, error); }
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': SHELL_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }, body };
    },
    assetRoute: {
      method: 'GET',
      path: '/projectops/assets/:file',
      handler: async (_request, _context, params) => {
        const name = params.file ?? '';
        const type = ASSET_TYPES[path.extname(name)];
        if (!type || !ASSET_NAME.test(name)) throw new HttpError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
        let body: Buffer;
        try { body = await readFile(path.join(assets, name)); }
        catch { throw new HttpError(404, 'ASSET_NOT_FOUND', 'Asset not found.'); }
        // The name carries a hash of the content, so a name never changes meaning: cache for a year.
        return { status: 200, headers: { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=31536000, immutable' }, body } satisfies DirectHttpResponse;
      },
    },
  };
}
