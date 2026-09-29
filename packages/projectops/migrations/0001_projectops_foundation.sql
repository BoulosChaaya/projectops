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
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (
    status IN ('new', 'estimated', 'approved', 'in_progress', 'delivered', 'archived')
  ),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS projectops_project_requests_client_status_idx
  ON projectops_project_requests (client_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_requests_status_updated_idx
  ON projectops_project_requests (status, updated_at DESC);
