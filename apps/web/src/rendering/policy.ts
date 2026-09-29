// EXEC-CLIENT-012..026: Route Rendering Strategy, Cache-Control & Asset Fingerprinting
import crypto from 'node:crypto';

export type RouteClass = 'public_marketing' | 'authenticated_dashboard' | 'interactive_widget';
export type RenderingStrategy = 'static_build' | 'dynamic_ssr' | 'client_island';

export function selectRenderingStrategy(routeClass: RouteClass): RenderingStrategy {
  switch (routeClass) {
    case 'public_marketing':
      return 'static_build';
    case 'authenticated_dashboard':
      return 'dynamic_ssr';
    case 'interactive_widget':
      return 'client_island';
  }
}

export function buildCacheControlHeader(options: {
  authenticated: boolean;
  immutableAsset?: boolean;
  publicMaxAgeSeconds?: number;
}): string {
  if (options.authenticated) {
    return 'private, no-cache, no-store, must-revalidate';
  }
  if (options.immutableAsset) {
    return 'public, max-age=31536000, immutable';
  }
  const maxAge = options.publicMaxAgeSeconds ?? 60;
  return `public, max-age=${maxAge}, stale-while-revalidate=30`;
}

export function fingerprintStaticAsset(filename: string, content: string | Buffer): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return `${filename}.${hash}`;
  return `${filename.slice(0, dotIdx)}.${hash}${filename.slice(dotIdx)}`;
}
