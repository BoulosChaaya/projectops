import {
  applyProjectOpsMigrations,
  type ProjectOpsSqlExecutor,
} from '../../../../packages/projectops/src/index.ts';
import { createProjectOpsDashboardWebRoute } from '../../../web/src/projectops/dashboard-route.ts';
import { startHttpListener, type HttpServer } from '../bootstrap/http-listener.ts';
import type { RouteDefinition } from '../http/path-matching.ts';
import type { HealthService } from '../health/health.service.ts';
import { createProjectOpsRoutes } from './routes.ts';
import { createProjectOpsRepositoryService } from './service.ts';
import type { ProjectOpsAccess } from './access.ts';

export interface ProjectOpsAppConfig {
  readonly sql: ProjectOpsSqlExecutor;
  readonly host?: string;
  readonly port?: number;
  readonly clock?: () => string;
  readonly migrate?: (sql: ProjectOpsSqlExecutor) => Promise<void>;
  readonly healthService?: HealthService;
  readonly access?: ProjectOpsAccess;
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
    createProjectOpsDashboardWebRoute(service),
  ];
  const routes = Object.freeze(config.access ? [
    ...productRoutes.map(route => config.access!.protect(route)), ...config.access.routes(),
  ] : productRoutes);
  const listener = await startHttpListener({
    host: config.host,
    port: config.port,
    routes,
    healthService: config.healthService,
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
