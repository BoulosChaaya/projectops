CREATE TABLE projectops_operator (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  default_currency TEXT NOT NULL DEFAULT 'USD' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_priority TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low', 'medium', 'high')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE projectops_operator_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  operator_id SMALLINT NOT NULL REFERENCES projectops_operator(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX projectops_operator_sessions_expiry ON projectops_operator_sessions(expires_at);

CREATE TABLE projectops_login_limit (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO projectops_login_limit (id) VALUES (1);
