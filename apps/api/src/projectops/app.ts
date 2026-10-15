import { createProjectHandoffRoutes } from '../../../web/src/projectops/project-handoff-routes.ts';
import {
  applyProjectOpsMigrations,
  type ProjectOpsSqlExecutor,
} from '../../../../packages/projectops/src/index.ts';
import { startHttpListener, type HttpServer } from '../bootstrap/http-listener.ts';
import type { RouteDefinition } from '../http/path-matching.ts';
import type { KernelRouteHandler } from '../bootstrap/http-listener.ts';
import type { HealthService } from '../health/health.service.ts';
import type { Logger } from '../../../../packages/logger/src/index.ts';
import { createProjectOpsRoutes, type ProjectOpsApiService } from './routes.ts';
import type { RequestContext } from '../http/request-context/context.ts';
import { createProjectOpsRepositoryService } from './service.ts';
import type { ProjectOpsAccess } from './access.ts';
import { createClientWebRoutes } from '../../../web/src/projectops/client-routes.ts';
import { createClientApp } from '../../../web/src/projectops/client-app.ts';

export interface ProjectOpsAppConfig {
  readonly sql: ProjectOpsSqlExecutor;
  readonly host?: string;
  readonly port?: number;
  readonly clock?: () => string;
  readonly migrate?: (sql: ProjectOpsSqlExecutor) => Promise<void>;
  readonly healthService?: HealthService;
  readonly access?: ProjectOpsAccess;
  /** Structured log destination; defaults to JSON lines on stdout. */
  readonly logger?: Logger;
  /** Directory of the built React client (index.html and assets/); defaults to apps/client/dist. */
  readonly clientDir?: string;
  /** The data of a demo sandbox, by schema (postgres-app.ts). Without it, demo sessions are refused. */
  readonly sandboxService?: (schema: string) => ProjectOpsApiService;
}

export interface ProjectOpsApp {
  readonly server: HttpServer;
  readonly routes: readonly RouteDefinition[];
  close(): Promise<void>;
}

export async function startProjectOpsApp(config: ProjectOpsAppConfig): Promise<ProjectOpsApp> {
  await (config.migrate ?? applyProjectOpsMigrations)(config.sql);

  const service = createProjectOpsRepositoryService(config.sql);
  // A demo session's requests use its sandbox, and only its sandbox. A session marked as a
  // sandbox is never served the main data, even if no sandbox service is configured.
  const serviceFor = (context: RequestContext): ProjectOpsApiService => {
    const schema = context.get<string>('projectops.sandbox');
    if (schema === undefined) return service;
    if (!config.sandboxService) throw new Error('Demo sandbox requested without sandbox support.');
    return config.sandboxService(schema);
  };
  const client = createClientApp(config.clientDir);
  const productRoutes = [
    // Pages rendered by the React client; like every product page, they require a session.
    { method: 'GET', path: '/projectops', handler: () => client.shell() } satisfies RouteDefinition<KernelRouteHandler>,
    ...createProjectOpsRoutes(service, config.clock, serviceFor),
    ...createClientWebRoutes(() => client.shell()),
    ...createProjectHandoffRoutes(service, config.clock ?? (() => new Date().toISOString()), serviceFor),
  ];
  const routes = Object.freeze([
    ...(config.access ? [...productRoutes.map(route => config.access!.protect(route)), ...config.access.routes(() => client.shell())] : productRoutes),
    client.assetRoute,
  ]);
  const listener = await startHttpListener({
    responseHeaders: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    host: config.host,
    port: config.port,
    routes,
    healthService: config.healthService,
    logger: config.logger,
  });
  // Keep the configured hostname: localhost may bind an IPv6 address, and
  // browser Origin must match the URL operators actually open.
  const host = config.host ?? listener.host;
  const server = Object.freeze({ ...listener,
    origin: `http://${host.includes(':') ? `[${host}]` : host}:${listener.port}`,
  });
  config.access?.configureOrigin(server.origin);

  return Object.freeze({
    server,
    routes,
    async close(): Promise<void> {
      await server.close();
    },
  });
}
