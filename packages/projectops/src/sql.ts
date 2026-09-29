import type { ProjectOpsClient, ProjectRequest, ProjectRequestStatus } from './domain.ts';

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const projectOpsSchemaSql = Object.freeze([
  `CREATE TABLE IF NOT EXISTS projectops_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_requests (
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
  )`,
  `CREATE INDEX IF NOT EXISTS projectops_project_requests_client_status_idx
    ON projectops_project_requests (client_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_requests_status_updated_idx
    ON projectops_project_requests (status, updated_at DESC)`,
] as const);

export function insertClientSql(client: ProjectOpsClient): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_clients (
      id, name, contact_name, email, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    params: Object.freeze([
      client.id,
      client.name,
      client.contactName ?? null,
      client.email ?? null,
      client.status,
      client.createdAtIso,
    ]),
  });
}

export function insertProjectRequestSql(request: ProjectRequest): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_requests (
      id, client_id, title, brief, budget_range, deadline_at, priority, status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    params: Object.freeze([
      request.id,
      request.clientId,
      request.title,
      request.brief,
      request.budgetRange ?? null,
      request.deadlineIso ?? null,
      request.priority,
      request.status,
      request.createdAtIso,
      request.updatedAtIso,
    ]),
  });
}

export function updateProjectRequestStatusSql(
  id: string,
  status: ProjectRequestStatus,
  updatedAtIso: string
): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_requests
      SET status = $2, updated_at = $3
      WHERE id = $1
      RETURNING *`,
    params: Object.freeze([id, status, updatedAtIso]),
  });
}

export function selectProjectRequestByIdSql(id: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_requests
      WHERE id = $1`,
    params: Object.freeze([id]),
  });
}

export function selectDashboardRowsSql(): SqlStatement {
  return Object.freeze({
    sql: `SELECT
      pr.id,
      pr.client_id,
      c.name AS client_name,
      pr.title,
      pr.priority,
      pr.status,
      pr.deadline_at,
      pr.updated_at
    FROM projectops_project_requests pr
    JOIN projectops_clients c ON c.id = pr.client_id
    WHERE pr.status != 'archived'
    ORDER BY pr.updated_at DESC, pr.created_at DESC`,
    params: Object.freeze([]),
  });
}
