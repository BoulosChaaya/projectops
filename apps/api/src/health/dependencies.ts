// EXEC-FOUND-022: Dependency Health Aggregation
import type { HealthStatus } from './liveness.ts';

export interface DependencyHealthCheck {
  readonly name: string;
  check(): Promise<boolean> | boolean;
}

export async function aggregateDependencyHealth(
  checks: readonly DependencyHealthCheck[]
): Promise<HealthStatus & { readonly failingDependencies: readonly string[] }> {
  const failing: string[] = [];

  for (const dep of checks) {
    try {
      const ok = await dep.check();
      if (!ok) {
        failing.push(dep.name);
      }
    } catch {
      failing.push(dep.name);
    }
  }

  const allOk = failing.length === 0;
  return Object.freeze({
    ok: allOk,
    status: allOk ? 'healthy' : 'unhealthy',
    failingDependencies: Object.freeze(failing),
    details: Object.freeze({ failingDependencies: failing }),
  });
}
