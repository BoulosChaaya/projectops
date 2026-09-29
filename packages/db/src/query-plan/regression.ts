// EXEC-DB-057: Plan Regression Detection
import type { QueryPlan } from './interpret.ts';

export interface PlanRegression {
  readonly reason: 'index_to_seq_scan_degradation' | 'cost_spike';
  readonly baselineNodeType: string;
  readonly currentNodeType: string;
  readonly baselineCost: number;
  readonly currentCost: number;
}

export function detectPlanRegression(
  baseline: QueryPlan,
  current: QueryPlan
): PlanRegression | null {
  if (baseline.nodeType === 'Index Scan' && current.nodeType === 'Seq Scan') {
    return Object.freeze({
      reason: 'index_to_seq_scan_degradation',
      baselineNodeType: baseline.nodeType,
      currentNodeType: current.nodeType,
      baselineCost: baseline.totalCost,
      currentCost: current.totalCost,
    });
  }

  if (current.totalCost > baseline.totalCost * 3) {
    return Object.freeze({
      reason: 'cost_spike',
      baselineNodeType: baseline.nodeType,
      currentNodeType: current.nodeType,
      baselineCost: baseline.totalCost,
      currentCost: current.totalCost,
    });
  }

  return null;
}
