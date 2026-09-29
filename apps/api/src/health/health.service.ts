// EXEC-FOUND-019: Service Health & Readiness
import { liveness, type HealthStatus } from './liveness.ts';
import { readiness } from './readiness.ts';
import { aggregateDependencyHealth, type DependencyHealthCheck } from './dependencies.ts';

export class HealthService {
  private initialized = false;
  private fatal = false;
  private readonly checks: DependencyHealthCheck[];

  constructor(checks: readonly DependencyHealthCheck[] = []) {
    this.checks = [...checks];
  }

  public setInitialized(value: boolean): void {
    this.initialized = value;
  }

  public setFatalState(value: boolean): void {
    this.fatal = value;
  }

  public checkLiveness(): HealthStatus {
    return liveness(this.fatal);
  }

  public async checkReadiness(): Promise<HealthStatus> {
    if (this.fatal) {
      return Object.freeze({ ok: false, status: 'unhealthy' });
    }
    return await readiness(this.initialized, this.checks);
  }

  public async aggregateDependencies(): Promise<HealthStatus> {
    return await aggregateDependencyHealth(this.checks);
  }
}
