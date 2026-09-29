// EXEC-FOUND-008: Required Configuration Presence Check
import type { Environment } from './environment.ts';

export class MissingConfigError extends Error {
  public readonly key: string;
  public readonly code = 'CONFIG_REQUIRED_MISSING';

  constructor(key: string) {
    super(`Required configuration key "${key}" is missing or empty.`);
    this.name = 'MissingConfigError';
    this.key = key;
  }
}

export function requireConfig(key: string, env: Environment = process.env): string {
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new TypeError('Configuration key name must be a non-empty string.');
  }
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new MissingConfigError(key);
  }
  return raw.trim();
}
