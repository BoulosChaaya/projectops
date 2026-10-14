// EXEC-FOUND-034: HTTP Listener & EXEC-FOUND-060: Request-Serving System
import type http from 'node:http';
import { createLogger, describeError, type Logger } from '../../../../packages/logger/src/index.ts';
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

// Every 503 here is temporary (overload or an unreachable database); tell clients when to retry.
const RETRY_AFTER_SECONDS = '5';

/** The request path without its query string: queries can carry search terms and other user input. */
export function requestPath(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0]!.split('#')[0]!;
  return path.length > 512 ? `${path.slice(0, 512)}…` : path;
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
        const serialized = serializeResponse(errBody, { status: 503, headers: { 'retry-after': RETRY_AFTER_SECONDS } });
        logger.warn('http.request.rejected', { code: errBody.code, status: 503, method: req.method, path: requestPath(req.url) });
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
        const entry = {
          correlationId: normalized.correlationId,
          method: req.method,
          path: requestPath(req.url),
          code: normalized.code,
          status: normalized.status,
        };
        // Client errors are expected outcomes (validation, missing session, conflicts): a warning
        // without a stack. Server errors are what an operator must diagnose from the log alone,
        // because the response deliberately hides the cause: log the error itself at error level.
        // A deliberate HttpError without a cause (such as SERVICE_NOT_READY) is fully described by
        // its code, so its stack would only point at the line that threw it.
        if (normalized.status >= 500) {
          const deliberate = error instanceof HttpError && error.cause === undefined;
          logger.error('http.request.failed', deliberate ? entry : { ...entry, error: describeError(error) });
        } else {
          logger.warn('http.request.error', entry);
        }

        const serializedErr = serializeResponse(normalized, {
          status: normalized.status,
          correlationId: normalized.correlationId,
          ...(normalized.status === 503 ? { headers: { 'retry-after': RETRY_AFTER_SECONDS } } : {}),
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
