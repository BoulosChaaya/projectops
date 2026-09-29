// EXEC-CICD-030..044: Rollback Feasibility Classifier & Progressive Canary Controller
export interface ReleaseFeasibilityInput {
  readonly appArtifactStateless: boolean;
  readonly schemaChangeKind: 'none' | 'expand_only_reversible' | 'destructive_irreversible';
  readonly externalSideEffectsReversible: boolean;
}

export interface RollbackFeasibilityReport {
  readonly automatedRollbackSafe: boolean;
  readonly strategy: 'instant_artifact_rollback' | 'forward_fix_required';
}

export function classifyRollbackFeasibility(
  input: ReleaseFeasibilityInput
): RollbackFeasibilityReport {
  const safe =
    input.appArtifactStateless &&
    input.schemaChangeKind !== 'destructive_irreversible' &&
    input.externalSideEffectsReversible;
  return Object.freeze({
    automatedRollbackSafe: safe,
    strategy: safe ? 'instant_artifact_rollback' : 'forward_fix_required',
  });
}

export function evaluateCanaryPromotion(metrics: {
  readonly currentStagePercent: number;
  readonly errorRate: number;
  readonly maxAllowedErrorRate: number;
}): { readonly action: 'promote' | 'rollback'; readonly nextTrafficPercent: number } {
  if (metrics.errorRate > metrics.maxAllowedErrorRate) {
    return Object.freeze({ action: 'rollback', nextTrafficPercent: 0 });
  }
  const next = metrics.currentStagePercent < 50 ? 50 : 100;
  return Object.freeze({ action: 'promote', nextTrafficPercent: next });
}
