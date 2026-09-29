// EXEC-FOUND-021: Readiness Check
import { aggregateDependencyHealth, type DependencyHealthCheck } from './dependencies.ts';
import type { HealthStatus } from './liveness.ts';

export async function readiness(
  startupInitialized: boolean,
  checks: readonly DependencyHealthCheck[] = []
): Promise<HealthStatus> {
  if (!startupInitialized) {
    return Object.freeze({
      ok: false,
      status: 'unhealthy',
      details: Object.freeze({ reason: 'startup_not_initialized' }),
    });
  }
  return await aggregateDependencyHealth(checks);
}
