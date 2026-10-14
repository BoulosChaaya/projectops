// EXEC-FOUND-019: Service Health & Readiness
import { liveness, type HealthStatus } from './liveness.ts';
import { readiness } from './readiness.ts';
import { aggregateDependencyHealth, type DependencyHealthCheck } from './dependencies.ts';

export class HealthService {
  private initialized = false;
  private fatal = false;
  private readonly checks: DependencyHealthCheck[];
  private readonly release?: Readonly<Record<string, string>>;

  /** `release` (for example the deployed Git commit) is reported by liveness so a deploy can be verified from outside. */
  constructor(checks: readonly DependencyHealthCheck[] = [], release?: Readonly<Record<string, string>>) {
    this.checks = [...checks];
    if (release && Object.keys(release).length > 0) this.release = Object.freeze({ ...release });
  }

  public setInitialized(value: boolean): void {
    this.initialized = value;
  }

  public setFatalState(value: boolean): void {
    this.fatal = value;
  }

  public checkLiveness(): HealthStatus {
    const status = liveness(this.fatal);
    return this.release ? Object.freeze({ ...status, details: this.release }) : status;
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
