import { createProjectHandoffRoutes } from '../../../web/src/projectops/project-handoff-routes.ts';
import {
  applyProjectOpsMigrations,
  type ProjectOpsSqlExecutor,
} from '../../../../packages/projectops/src/index.ts';
import { createProjectOpsDashboardWebRoute } from '../../../web/src/projectops/dashboard-route.ts';
import { startHttpListener, type HttpServer } from '../bootstrap/http-listener.ts';
import type { RouteDefinition } from '../http/path-matching.ts';
import type { HealthService } from '../health/health.service.ts';
import type { Logger } from '../../../../packages/logger/src/index.ts';
import { createProjectOpsRoutes } from './routes.ts';
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
}

export interface ProjectOpsApp {
  readonly server: HttpServer;
  readonly routes: readonly RouteDefinition[];
  close(): Promise<void>;
}

export async function startProjectOpsApp(config: ProjectOpsAppConfig): Promise<ProjectOpsApp> {
  await (config.migrate ?? applyProjectOpsMigrations)(config.sql);

  const service = createProjectOpsRepositoryService(config.sql);
  const productRoutes = [
    ...createProjectOpsRoutes(service, config.clock),
    createProjectOpsDashboardWebRoute(service, config.clock),
    ...createClientWebRoutes(),
    ...createProjectHandoffRoutes(service, config.clock ?? (() => new Date().toISOString())),
  ];
  const client = createClientApp(config.clientDir);
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
