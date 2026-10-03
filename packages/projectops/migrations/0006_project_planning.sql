ALTER TABLE projectops_project_milestones
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);

ALTER TABLE projectops_project_tasks
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
