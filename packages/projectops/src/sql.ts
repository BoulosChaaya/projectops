import type {
  ProjectMilestone,
  ProjectOpsClient,
  ProjectRequest,
  ProjectRequestStatus,
} from './domain.ts';

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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_milestones (
    id TEXT NOT NULL,
    project_request_id TEXT NOT NULL REFERENCES projectops_project_requests(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (project_request_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS projectops_project_requests_client_status_idx
    ON projectops_project_requests (client_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_requests_status_updated_idx
    ON projectops_project_requests (status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_milestones_request_status_idx
    ON projectops_project_milestones (project_request_id, status)`,
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
      id,
      client_id,
      title,
      brief,
      budget_range,
      deadline_at,
      estimate_amount_cents,
      estimate_currency,
      estimated_at,
      approved_at,
      approved_by,
      priority,
      status,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *`,
    params: Object.freeze([
      request.id,
      request.clientId,
      request.title,
      request.brief,
      request.budgetRange ?? null,
      request.deadlineIso ?? null,
      request.estimateAmountCents ?? null,
      request.estimateCurrency ?? null,
      request.estimatedAtIso ?? null,
      request.approvedAtIso ?? null,
      request.approvedBy ?? null,
      request.priority,
      request.status,
      request.createdAtIso,
      request.updatedAtIso,
    ]),
  });
}

export function estimateProjectRequestSql(request: ProjectRequest): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_requests
      SET
        estimate_amount_cents = $2,
        estimate_currency = $3,
        estimated_at = $4,
        status = $5,
        updated_at = $6
      WHERE id = $1
      RETURNING *`,
    params: Object.freeze([
      request.id,
      request.estimateAmountCents ?? null,
      request.estimateCurrency ?? null,
      request.estimatedAtIso ?? null,
      request.status,
      request.updatedAtIso,
    ]),
  });
}

export function approveProjectRequestSql(request: ProjectRequest): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_requests
      SET
        approved_at = $2,
        approved_by = $3,
        status = $4,
        updated_at = $5
      WHERE id = $1
      RETURNING *`,
    params: Object.freeze([
      request.id,
      request.approvedAtIso ?? null,
      request.approvedBy ?? null,
      request.status,
      request.updatedAtIso,
    ]),
  });
}

export function insertProjectMilestoneSql(milestone: ProjectMilestone): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_milestones (
      id,
      project_request_id,
      title,
      due_at,
      status,
      created_at,
      completed_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    params: Object.freeze([
      milestone.id,
      milestone.projectRequestId,
      milestone.title,
      milestone.dueAtIso ?? null,
      milestone.status,
      milestone.createdAtIso,
      milestone.completedAtIso ?? null,
      milestone.updatedAtIso,
    ]),
  });
}

export function selectProjectMilestonesSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_milestones
      WHERE project_request_id = $1
      ORDER BY due_at ASC NULLS LAST, created_at ASC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectMilestoneByIdSql(
  projectRequestId: string,
  milestoneId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_milestones
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, milestoneId]),
  });
}

export function completeProjectMilestoneSql(milestone: ProjectMilestone): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_milestones
      SET status = $3, completed_at = $4, updated_at = $5
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      milestone.projectRequestId,
      milestone.id,
      milestone.status,
      milestone.completedAtIso ?? null,
      milestone.updatedAtIso,
    ]),
  });
}

export function selectClientsSql(): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_clients
      ORDER BY created_at DESC, id ASC`,
    params: Object.freeze([]),
  });
}

export function selectClientByIdSql(id: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_clients
      WHERE id = $1`,
    params: Object.freeze([id]),
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

export function selectProjectRequestsSql(): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_requests
      ORDER BY updated_at DESC, created_at DESC, id ASC`,
    params: Object.freeze([]),
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
      pr.estimate_amount_cents,
      pr.estimate_currency,
      pr.estimated_at,
      pr.approved_at,
      pr.approved_by,
      COALESCE(ms.open_milestones, 0) AS open_milestone_count,
      COALESCE(ms.completed_milestones, 0) AS completed_milestone_count,
      pr.updated_at
    FROM projectops_project_requests pr
    JOIN projectops_clients c ON c.id = pr.client_id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_milestones,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_milestones
      FROM projectops_project_milestones
      GROUP BY project_request_id
    ) ms ON ms.project_request_id = pr.id
    WHERE pr.status != 'archived'
    ORDER BY pr.updated_at DESC, pr.created_at DESC`,
    params: Object.freeze([]),
  });
}
