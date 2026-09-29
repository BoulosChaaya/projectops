// EXEC-FOUND-007: Runtime Configuration Validation
import { loadEnvironment, type Environment } from './environment.ts';
import { requireConfig } from './required.ts';
import { parseConfigValue } from './parsers.ts';
import { resolveConfigDefault } from './defaults.ts';
import { resolvePort } from './port.ts';

export interface RuntimeConfig {
  readonly SERVICE_NAME: string;
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly HOST: string;
  readonly PORT: number;
  readonly LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly SHUTDOWN_TIMEOUT_MS: number;
  readonly DATABASE_URL?: string;
}

export function validateRuntimeConfig(rawEnv: Record<string, string | undefined> = process.env): RuntimeConfig {
  const env: Environment = loadEnvironment(rawEnv);

  const serviceName = requireConfig('SERVICE_NAME', env);

  const rawNodeEnv = resolveConfigDefault('NODE_ENV', env.NODE_ENV);
  const nodeEnv = parseConfigValue('NODE_ENV', rawNodeEnv, {
    type: 'enum',
    choices: ['development', 'test', 'production'],
  }) as RuntimeConfig['NODE_ENV'];

  const rawHost = resolveConfigDefault('HOST', env.HOST);
  const host = parseConfigValue('HOST', rawHost, { type: 'string' }) as string;

  const rawPort = resolveConfigDefault('PORT', env.PORT);
  const port = resolvePort({ PORT: rawPort as number | string });

  const rawLogLevel = resolveConfigDefault('LOG_LEVEL', env.LOG_LEVEL);
  const logLevel = parseConfigValue('LOG_LEVEL', rawLogLevel, {
    type: 'enum',
    choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
  }) as RuntimeConfig['LOG_LEVEL'];

  const rawShutdown = resolveConfigDefault('SHUTDOWN_TIMEOUT_MS', env.SHUTDOWN_TIMEOUT_MS);
  const shutdownTimeoutMs = parseConfigValue('SHUTDOWN_TIMEOUT_MS', rawShutdown, {
    type: 'integer',
    min: 100,
    max: 300000,
  }) as number;

  let databaseUrl: string | undefined;
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== '') {
    databaseUrl = parseConfigValue('DATABASE_URL', env.DATABASE_URL, {
      type: 'url',
      secret: true,
    }) as string;
  }

  return Object.freeze({
    SERVICE_NAME: serviceName,
    NODE_ENV: nodeEnv,
    HOST: host,
    PORT: port,
    LOG_LEVEL: logLevel,
    SHUTDOWN_TIMEOUT_MS: shutdownTimeoutMs,
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  });
}
