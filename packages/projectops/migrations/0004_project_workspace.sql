ALTER TABLE projectops_project_requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
