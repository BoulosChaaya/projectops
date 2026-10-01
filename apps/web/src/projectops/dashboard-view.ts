import {
  composeProjectOpsDashboard,
  type ProjectOpsDashboardRow,
  type ProjectOpsDashboardView,
} from '../../../../packages/projectops/src/index.ts';

export interface ProjectOpsDashboardPage {
  readonly title: 'ProjectOps Dashboard';
  readonly summary: ProjectOpsDashboardView;
}

export function composeProjectOpsDashboardPageFromSummary(
  summary: ProjectOpsDashboardView
): ProjectOpsDashboardPage {
  return Object.freeze({
    title: 'ProjectOps Dashboard',
    summary,
  });
}

export function composeProjectOpsDashboardPage(
  rows: readonly ProjectOpsDashboardRow[]
): ProjectOpsDashboardPage {
  return composeProjectOpsDashboardPageFromSummary(composeProjectOpsDashboard(rows));
}
