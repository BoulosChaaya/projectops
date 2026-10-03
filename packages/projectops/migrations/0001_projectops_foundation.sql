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

CREATE TABLE IF NOT EXISTS projectops_project_invoices (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  deliverable_id TEXT,
  invoice_number TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL CHECK (status IN ('issued', 'paid')),
  issued_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id),
  UNIQUE (project_request_id, invoice_number),
  FOREIGN KEY (project_request_id, deliverable_id)
    REFERENCES projectops_project_deliverables(project_request_id, id)
    ON DELETE SET NULL (deliverable_id)
);

CREATE TABLE IF NOT EXISTS projectops_project_change_requests (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  estimate_delta_cents INTEGER CHECK (estimate_delta_cents IS NULL OR estimate_delta_cents > 0),
  estimate_currency TEXT CHECK (estimate_currency IS NULL OR estimate_currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id),
  CHECK (
    (estimate_delta_cents IS NULL AND estimate_currency IS NULL) OR
    (estimate_delta_cents IS NOT NULL AND estimate_currency IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS projectops_project_issues (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  opened_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE TABLE IF NOT EXISTS projectops_project_risks (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  probability TEXT NOT NULL CHECK (probability IN ('low', 'medium', 'high')),
  impact TEXT NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
  mitigation_plan TEXT,
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'mitigated')),
  identified_at TIMESTAMPTZ NOT NULL,
  mitigated_at TIMESTAMPTZ,
  mitigation_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE TABLE IF NOT EXISTS projectops_project_feedback (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  deliverable_id TEXT,
  author TEXT NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'addressed')),
  received_at TIMESTAMPTZ NOT NULL,
  addressed_at TIMESTAMPTZ,
  addressed_by TEXT,
  response_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id),
  FOREIGN KEY (project_request_id, deliverable_id)
    REFERENCES projectops_project_deliverables(project_request_id, id)
    ON DELETE SET NULL (deliverable_id)
);

CREATE TABLE IF NOT EXISTS projectops_project_documents (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  deliverable_id TEXT,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('proposal', 'contract', 'asset', 'handoff', 'other')),
  url TEXT NOT NULL CHECK (url ~ '^https?://'),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id),
  FOREIGN KEY (project_request_id, deliverable_id)
    REFERENCES projectops_project_deliverables(project_request_id, id)
    ON DELETE SET NULL (deliverable_id)
);

CREATE TABLE IF NOT EXISTS projectops_project_notes (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('internal', 'client')),
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE TABLE IF NOT EXISTS projectops_project_tasks (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE TABLE IF NOT EXISTS projectops_project_work_logs (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  task_id TEXT,
  actor TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  billable BOOLEAN NOT NULL,
  note TEXT,
  logged_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id),
  FOREIGN KEY (project_request_id, task_id)
    REFERENCES projectops_project_tasks(project_request_id, id)
    ON DELETE SET NULL (task_id)
);

CREATE TABLE IF NOT EXISTS projectops_project_expenses (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('software', 'asset', 'service', 'travel', 'other')),
  description TEXT NOT NULL,
  vendor TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reimbursable BOOLEAN NOT NULL,
  receipt_url TEXT CHECK (receipt_url IS NULL OR receipt_url ~ '^https?://'),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected')),
  incurred_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE TABLE IF NOT EXISTS projectops_project_activities (
  id TEXT NOT NULL,
  project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'request_created',
      'request_estimated',
      'request_approved',
      'status_changed',
      'milestone_created',
      'milestone_completed',
      'deliverable_submitted',
      'deliverable_accepted',
      'invoice_issued',
      'invoice_paid',
      'note_added'
    )
  ),
  summary TEXT NOT NULL,
  actor TEXT,
  happened_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_request_id, id)
);

CREATE INDEX IF NOT EXISTS projectops_project_requests_client_status_idx
  ON projectops_project_requests (client_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_requests_status_updated_idx
  ON projectops_project_requests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS projectops_project_milestones_request_status_idx
  ON projectops_project_milestones (project_request_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_deliverables_request_status_idx
  ON projectops_project_deliverables (project_request_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_invoices_request_status_idx
  ON projectops_project_invoices (project_request_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_change_requests_request_status_idx
  ON projectops_project_change_requests (project_request_id, status);

CREATE INDEX IF NOT EXISTS projectops_project_issues_request_status_idx
  ON projectops_project_issues (project_request_id, status, severity);

CREATE INDEX IF NOT EXISTS projectops_project_risks_request_status_idx
  ON projectops_project_risks (project_request_id, status, impact, probability);

CREATE INDEX IF NOT EXISTS projectops_project_feedback_request_status_idx
  ON projectops_project_feedback (project_request_id, status, sentiment);

CREATE INDEX IF NOT EXISTS projectops_project_documents_request_status_idx
  ON projectops_project_documents (project_request_id, status, document_type);

CREATE INDEX IF NOT EXISTS projectops_project_notes_request_status_idx
  ON projectops_project_notes (project_request_id, status, visibility);

CREATE INDEX IF NOT EXISTS projectops_project_tasks_request_status_idx
  ON projectops_project_tasks (project_request_id, status, priority, due_at);

CREATE INDEX IF NOT EXISTS projectops_project_work_logs_request_time_idx
  ON projectops_project_work_logs (project_request_id, logged_at DESC, billable);

CREATE INDEX IF NOT EXISTS projectops_project_expenses_request_status_idx
  ON projectops_project_expenses (project_request_id, status, category, incurred_at DESC);

CREATE INDEX IF NOT EXISTS projectops_project_activities_request_time_idx
  ON projectops_project_activities (project_request_id, happened_at DESC);
