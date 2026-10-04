import {
  composeProjectOpsDashboard,
  type ProjectOpsDashboardRow,
  type ProjectOpsDashboardView,
} from '../../../../packages/projectops/src/index.ts';

export interface ProjectOpsDashboardPage {
  readonly title: 'ProjectOps Dashboard';
  readonly timezone: string;
  readonly summary: ProjectOpsDashboardView;
}

export function composeProjectOpsDashboardPageFromSummary(
  summary: ProjectOpsDashboardView, timezone = 'UTC'
): ProjectOpsDashboardPage {
  return Object.freeze({
    title: 'ProjectOps Dashboard', timezone,
    summary,
  });
}

export function composeProjectOpsDashboardPage(
  rows: readonly ProjectOpsDashboardRow[]
): ProjectOpsDashboardPage {
  return composeProjectOpsDashboardPageFromSummary(composeProjectOpsDashboard(rows));
}
