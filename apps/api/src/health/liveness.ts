// EXEC-FOUND-020: Liveness Check
export interface HealthStatus {
  readonly ok: boolean;
  readonly status: 'healthy' | 'unhealthy';
  readonly details?: Readonly<Record<string, unknown>>;
}

export function liveness(fatalState = false): HealthStatus {
  if (fatalState) {
    return Object.freeze({ ok: false, status: 'unhealthy' });
  }
  return Object.freeze({ ok: true, status: 'healthy' });
}
