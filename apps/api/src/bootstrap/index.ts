// EXEC-FOUND-002: Process Startup & EXEC-FOUND-033: Runnable Service
import { validateRuntimeConfig, type RuntimeConfig } from '../../../../packages/config/src/runtime-config.ts';
import { createLogger, type Logger } from '../../../../packages/logger/src/index.ts';
import { runtimeLifecycleStateModel, type LifecycleStateMachine } from '../../../../packages/runtime/lifecycle/state.ts';
import { inFlightRequestDraining, type InFlightDrainer } from '../../../../packages/runtime/lifecycle/draining.ts';
import { signalFault } from '../../../../packages/runtime/src/faults/signal.ts';
import { HealthService } from '../health/health.service.ts';
import { initializeDependencies, type DependencyUnit } from './dependencies.ts';
import { shutdownOnFatal } from './fatal-shutdown.ts';
import { bindNetwork, type BoundAddress } from './network.ts';

export interface BootstrapOptions {
  env?: Record<string, string | undefined>;
  dependencies?: readonly DependencyUnit[];
  logger?: Logger;
}

export interface BootstrappedService {
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly stateMachine: LifecycleStateMachine;
  readonly drainer: InFlightDrainer;
  readonly health: HealthService;
  readonly bound: BoundAddress;
  shutdown(): Promise<void>;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrappedService> {
  const stateMachine = runtimeLifecycleStateModel.createStateMachine();
  const drainer = inFlightRequestDraining();
  const config = validateRuntimeConfig(options.env ?? process.env);
  const logger =
    options.logger ??
    createLogger({
      minLevel: config.LOG_LEVEL,
      context: { service: config.SERVICE_NAME, env: config.NODE_ENV },
    });

  const health = new HealthService();

  try {
    await initializeDependencies(options.dependencies ?? []);
    health.setInitialized(true);

    const bound = await bindNetwork(
      { HOST: config.HOST, PORT: config.PORT },
      async (req, res) => {
        if (!drainer.tryEnter()) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'draining' }));
          return;
        }
        try {
          if (req.url === '/health/live') {
            const live = health.checkLiveness();
            res.writeHead(live.ok ? 200 : 503, { 'content-type': 'application/json' });
            res.end(JSON.stringify(live));
            return;
          }
          if (req.url === '/health/ready') {
            const ready = await health.checkReadiness();
            res.writeHead(ready.ok ? 200 : 503, { 'content-type': 'application/json' });
            res.end(JSON.stringify(ready));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ service: config.SERVICE_NAME, status: 'accepting' }));
        } finally {
          drainer.leave();
        }
      }
    );

    stateMachine.transitionTo('accepting');
    logger.info('service.started', { host: bound.host, port: bound.port });

    return Object.freeze({
      config,
      logger,
      stateMachine,
      drainer,
      health,
      bound,
      async shutdown(): Promise<void> {
        const sig = signalFault(new Error('Graceful shutdown requested'));
        await shutdownOnFatal(sig, {
          stateMachine,
          drainer,
          resources: [{ name: 'http-listener', close: () => bound.close() }],
          deadlineMs: config.SHUTDOWN_TIMEOUT_MS,
        });
      },
    });
  } catch (error) {
    if (stateMachine.canTransitionTo('stopped')) {
      stateMachine.transitionTo('stopped');
    }
    logger.fatal('service.bootstrap.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
