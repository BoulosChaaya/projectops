// EXEC-DB-055: Query Plan Analysis
import { explain } from './interpret.ts';
import { detectPlanRegression } from './regression.ts';

export const QueryPlanAnalyzer = Object.freeze({
  explain,
  detectPlanRegression,
});
