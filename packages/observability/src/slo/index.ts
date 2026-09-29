// EXEC-OBS-015..031: SLO Error-Budget Burn-Rate Evaluator & Alert Deduplication
export interface SloEvaluation {
  readonly availabilityRatio: number;
  readonly targetRatio: number;
  readonly errorBudgetRemainingRatio: number;
  readonly burnRate: number;
  readonly pageAlertTriggered: boolean;
}

export interface SloBurnRateInput {
  readonly totalRequests: number;
  readonly failedRequests: number;
  readonly targetAvailability: number;
}

export function evaluateSloBurnRate(input: SloBurnRateInput): SloEvaluation {
  if (input.totalRequests <= 0) {
    return Object.freeze({
      availabilityRatio: 1,
      targetRatio: input.targetAvailability,
      errorBudgetRemainingRatio: 1,
      burnRate: 0,
      pageAlertTriggered: false,
    });
  }
  const errorRatio = input.failedRequests / input.totalRequests;
  const availabilityRatio = 1 - errorRatio;
  const allowedErrorRatio = Math.max(0.000000001, 1 - input.targetAvailability);
  const burnRate = Number((errorRatio / allowedErrorRatio).toFixed(2));
  const remaining = Math.max(0, Number(((allowedErrorRatio - errorRatio) / allowedErrorRatio).toFixed(4)));

  return Object.freeze({
    availabilityRatio,
    targetRatio: input.targetAvailability,
    errorBudgetRemainingRatio: remaining,
    burnRate,
    pageAlertTriggered: burnRate >= 10,
  });
}

export class AlertDeduplicator {
  private readonly suppressionWindowMs: number;
  private readonly lastFiredByFingerprint = new Map<string, number>();

  constructor(suppressionWindowMs = 300000) {
    this.suppressionWindowMs = suppressionWindowMs;
  }

  public shouldEmitAlert(fingerprint: string, nowMs: number = Date.now()): boolean {
    const last = this.lastFiredByFingerprint.get(fingerprint);
    if (last !== undefined && nowMs - last < this.suppressionWindowMs) {
      return false;
    }
    this.lastFiredByFingerprint.set(fingerprint, nowMs);
    return true;
  }
}
