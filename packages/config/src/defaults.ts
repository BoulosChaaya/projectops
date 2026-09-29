// EXEC-FOUND-010: Configuration Default Resolution
import type { ConfigValue } from './parsers.ts';

const DEFAULT_REGISTRY: Readonly<Record<string, ConfigValue>> = Object.freeze({
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'info',
  SHUTDOWN_TIMEOUT_MS: 10000,
});

export function resolveConfigDefault(
  key: string,
  suppliedValue?: string | undefined,
  defaults: Readonly<Record<string, ConfigValue>> = DEFAULT_REGISTRY
): ConfigValue | undefined {
  if (suppliedValue !== undefined && suppliedValue !== '') {
    return suppliedValue;
  }
  return Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : undefined;
}
