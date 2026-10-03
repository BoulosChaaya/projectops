ALTER TABLE projectops_clients ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
