// EXEC-FOUND-034: HTTP Listener & EXEC-FOUND-060: Request-Serving System
import type http from 'node:http';
import { createLogger, type Logger } from '../../../../packages/logger/src/index.ts';
import { HealthService } from '../health/health.service.ts';
import { bindNetwork } from './network.ts';
import { createConnectionTracker, acceptConnection } from '../http/connection.ts';
import { createConnectionConcurrencyPolicy } from '../http/concurrency.ts';
import { createConnectionTimeoutPolicy } from '../http/timeouts.ts';
import { parseRequest, type ParsedRequest } from '../http/request.ts';
import { routeRequest } from '../http/routing.ts';
import type { RouteDefinition } from '../http/path-matching.ts';
import { serializeResponse } from '../http/response.ts';
import { normalizeError } from '../http/errors/normalize.ts';
import { HttpError } from '../http/errors/classify.ts';
import { runStateless } from '../http/request-context/stateless.ts';
import type { RequestContext } from '../http/request-context/context.ts';
import { resolveRequestIdentity } from '../kernel/request-context/request-identity.ts';

export type KernelRouteHandler = (
  request: ParsedRequest,
  context: RequestContext,
  params: Readonly<Record<string, string>>
) => unknown | Promise<unknown>;

export interface HttpListenerConfig {
  /** Application-owned policy, applied at serialization for success and early errors alike. */
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly host?: string;
  readonly port?: number;
  readonly maxConcurrentRequests?: number;
  readonly requestTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly routes?: readonly RouteDefinition<KernelRouteHandler>[];
  readonly healthService?: HealthService;
  readonly logger?: Logger;
}

export interface HttpServer {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
  readonly rawServer: http.Server;
  close(): Promise<void>;
}

export async function startHttpListener(config: HttpListenerConfig = {}): Promise<HttpServer> {
  const tracker = createConnectionTracker();
  const concurrency = createConnectionConcurrencyPolicy(config.maxConcurrentRequests ?? 100);
  const timeouts = createConnectionTimeoutPolicy({
    requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
    idleTimeoutMs: config.idleTimeoutMs ?? 30_000,
  });
  const logger = config.logger ?? createLogger({ minLevel: 'info' });
  const health = config.healthService ?? new HealthService();
  health.setInitialized(true);

  const builtInRoutes: RouteDefinition<KernelRouteHandler>[] = [
    {
      method: 'GET',
      path: '/health/live',
      handler: () => health.checkLiveness(),
    },
    {
      method: 'GET',
      path: '/health/ready',
      handler: async () => {
        const res = await health.checkReadiness();
        if (!res.ok) {
          throw new HttpError(503, 'SERVICE_NOT_READY', 'Service dependencies are not ready.', {
            status: res.status,
          });
        }
        return res;
      },
    },
  ];

  const allRoutes: readonly RouteDefinition<KernelRouteHandler>[] = [
    ...builtInRoutes,
    ...(config.routes ?? []),
  ];

  const bound = await bindNetwork(
    { HOST: config.host ?? '127.0.0.1', PORT: config.port ?? 0 },
    async (req, res) => {
      let correlationId: string | undefined;

      if (!concurrency.tryAcquire()) {
        const errBody = normalizeError(
          new HttpError(503, 'SERVER_BUSY', 'Maximum concurrent request limit reached.')
        );
        const serialized = serializeResponse(errBody, { status: 503 });
        res.writeHead(serialized.status, { ...serialized.headers, ...config.responseHeaders });
        res.end(serialized.body);
        return;
      }

      try {
        const rawCorrelation =
          typeof req.headers['x-correlation-id'] === 'string'
            ? req.headers['x-correlation-id']
            : undefined;
        const identity = resolveRequestIdentity(rawCorrelation);
        correlationId = identity.correlationId;

        const serialized = await timeouts.withTimeout(async () => {
          const parsedReq = await parseRequest({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: req,
            maxBodyBytes: config.maxBodyBytes,
          });

          const match = routeRequest(parsedReq, allRoutes);

          const { result, context } = await runStateless(
            async (r, ctx) => await match.route.handler(r, ctx, match.params),
            parsedReq
          );

          correlationId = context.correlationId;

          logger.info('http.request.completed', {
            correlationId: context.correlationId,
            requestId: context.requestId,
            method: parsedReq.method,
            path: parsedReq.path,
            status: result === undefined ? 204 : 200,
          });

          return serializeResponse(result, {
            accept: parsedReq.headers.get('accept'),
            correlationId: context.correlationId,
          });
        });

        res.writeHead(serialized.status, { ...serialized.headers, ...config.responseHeaders });
        res.end(serialized.body);
      } catch (error) {
        const normalized = normalizeError(error, correlationId);
        logger.warn('http.request.error', {
          correlationId: normalized.correlationId,
          code: normalized.code,
          status: normalized.status,
        });

        const serializedErr = serializeResponse(normalized, {
          status: normalized.status,
          correlationId: normalized.correlationId,
        });
        res.writeHead(serializedErr.status, { ...serializedErr.headers, ...config.responseHeaders });
        res.end(serializedErr.body);
      } finally {
        concurrency.release();
      }
    }
  );

  bound.server.keepAliveTimeout = timeouts.idleTimeoutMs;
  bound.server.on('connection', (socket) => {
    acceptConnection(socket, tracker);
  });

  return Object.freeze({
    host: bound.host,
    port: bound.port,
    origin: `http://${bound.host}:${bound.port}`,
    rawServer: bound.server,
    async close(): Promise<void> {
      await bound.close();
      tracker.destroyAll();
    },
  });
}
