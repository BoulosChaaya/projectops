-- Demo sandboxes: one row per visitor sandbox. The visitor's data lives in its own schema
-- (demo_<24 hex>), created from these same migrations; this table, in the main schema, is the
-- only record of which schemas exist, who holds them and when they expire.
CREATE TABLE projectops_demo_sandboxes (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  schema_name TEXT NOT NULL UNIQUE CHECK (schema_name ~ '^demo_[a-f0-9]{24}$'),
  csrf_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'ready')),
  default_currency TEXT NOT NULL DEFAULT 'EUR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_priority TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low', 'medium', 'high')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reset_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX projectops_demo_sandboxes_expiry ON projectops_demo_sandboxes(expires_at);
CREATE INDEX projectops_demo_sandboxes_created ON projectops_demo_sandboxes(created_at);
