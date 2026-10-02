CREATE TABLE IF NOT EXISTS projectops_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS projectops_project_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES projectops_clients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  budget_range TEXT,
  deadline_at TIMESTAMPTZ,
  estimate_amount_cents INTEGER CHECK (estimate_amount_cents IS NULL OR estimate_amount_cents > 0),
  estimate_currency TEXT CHECK (estimate_currency IS NULL OR estimate_currency ~ '^[A-Z]{3}$'),
  estimated_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (
    status IN ('new', 'estimated', 'approved', 'in_progress', 'delivered', 'archived')
  ),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS projectops_project_milestones (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE TABLE IF NOT EXISTS projectops_project_deliverables (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  milestone_id TEXT,
  title TEXT NOT NULL,
  artifact_url TEXT NOT NULL CHECK (artifact_url ~ '^https?://'),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'accepted')),
  submitted_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id),
  FOREIGN KEY (project_request_id, milestone_id)
    REFERENCES projectops_project_milestones(project_request_id, id)
    ON DELETE SET NULL (milestone_id)
);

CREATE INDEX IF NOT EXISTS projectops_project_requests_client_status_idx
  ON projectops_project_requests (client_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_requests_status_updated_idx
  ON projectops_project_requests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS projectops_project_milestones_request_status_idx
  ON projectops_project_milestones (project_request_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_deliverables_request_status_idx
  ON projectops_project_deliverables (project_request_id, status);
