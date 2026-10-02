import type {
  ProjectActivity,
  ProjectChangeRequest,
  ProjectDeliverable,
  ProjectDocument,
  ProjectFeedback,
  ProjectInvoice,
  ProjectIssue,
  ProjectMilestone,
  ProjectNote,
  ProjectOpsClient,
  ProjectRequest,
  ProjectRequestStatus,
  ProjectTask,
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
  `CREATE TABLE IF NOT EXISTS projectops_project_deliverables (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_invoices (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_change_requests (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_issues (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_feedback (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_documents (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_notes (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_tasks (
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
  )`,
  `CREATE TABLE IF NOT EXISTS projectops_project_activities (
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
  )`,
  `CREATE INDEX IF NOT EXISTS projectops_project_requests_client_status_idx
    ON projectops_project_requests (client_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_requests_status_updated_idx
    ON projectops_project_requests (status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_milestones_request_status_idx
    ON projectops_project_milestones (project_request_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_deliverables_request_status_idx
    ON projectops_project_deliverables (project_request_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_invoices_request_status_idx
    ON projectops_project_invoices (project_request_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_change_requests_request_status_idx
    ON projectops_project_change_requests (project_request_id, status)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_issues_request_status_idx
    ON projectops_project_issues (project_request_id, status, severity)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_feedback_request_status_idx
    ON projectops_project_feedback (project_request_id, status, sentiment)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_documents_request_status_idx
    ON projectops_project_documents (project_request_id, status, document_type)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_notes_request_status_idx
    ON projectops_project_notes (project_request_id, status, visibility)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_tasks_request_status_idx
    ON projectops_project_tasks (project_request_id, status, priority, due_at)`,
  `CREATE INDEX IF NOT EXISTS projectops_project_activities_request_time_idx
    ON projectops_project_activities (project_request_id, happened_at DESC)`,
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

export function insertProjectDeliverableSql(deliverable: ProjectDeliverable): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_deliverables (
      id,
      project_request_id,
      milestone_id,
      title,
      artifact_url,
      status,
      submitted_at,
      accepted_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    params: Object.freeze([
      deliverable.id,
      deliverable.projectRequestId,
      deliverable.milestoneId ?? null,
      deliverable.title,
      deliverable.artifactUrl,
      deliverable.status,
      deliverable.submittedAtIso,
      deliverable.acceptedAtIso ?? null,
      deliverable.updatedAtIso,
    ]),
  });
}

export function selectProjectDeliverablesSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_deliverables
      WHERE project_request_id = $1
      ORDER BY submitted_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectDeliverableByIdSql(
  projectRequestId: string,
  deliverableId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_deliverables
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, deliverableId]),
  });
}

export function acceptProjectDeliverableSql(deliverable: ProjectDeliverable): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_deliverables
      SET status = $3, accepted_at = $4, updated_at = $5
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      deliverable.projectRequestId,
      deliverable.id,
      deliverable.status,
      deliverable.acceptedAtIso ?? null,
      deliverable.updatedAtIso,
    ]),
  });
}

export function insertProjectInvoiceSql(invoice: ProjectInvoice): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_invoices (
      id,
      project_request_id,
      deliverable_id,
      invoice_number,
      amount_cents,
      currency,
      status,
      issued_at,
      due_at,
      paid_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    params: Object.freeze([
      invoice.id,
      invoice.projectRequestId,
      invoice.deliverableId ?? null,
      invoice.invoiceNumber,
      invoice.amountCents,
      invoice.currency,
      invoice.status,
      invoice.issuedAtIso,
      invoice.dueAtIso ?? null,
      invoice.paidAtIso ?? null,
      invoice.updatedAtIso,
    ]),
  });
}

export function selectProjectInvoicesSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_invoices
      WHERE project_request_id = $1
      ORDER BY issued_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectInvoiceByIdSql(
  projectRequestId: string,
  invoiceId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_invoices
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, invoiceId]),
  });
}

export function markProjectInvoicePaidSql(invoice: ProjectInvoice): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_invoices
      SET status = $3, paid_at = $4, updated_at = $5
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      invoice.projectRequestId,
      invoice.id,
      invoice.status,
      invoice.paidAtIso ?? null,
      invoice.updatedAtIso,
    ]),
  });
}

export function insertProjectChangeRequestSql(
  changeRequest: ProjectChangeRequest
): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_change_requests (
      id,
      project_request_id,
      title,
      description,
      requested_by,
      estimate_delta_cents,
      estimate_currency,
      status,
      requested_at,
      decided_at,
      decided_by,
      decision_note,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    params: Object.freeze([
      changeRequest.id,
      changeRequest.projectRequestId,
      changeRequest.title,
      changeRequest.description,
      changeRequest.requestedBy,
      changeRequest.estimateDeltaCents ?? null,
      changeRequest.estimateCurrency ?? null,
      changeRequest.status,
      changeRequest.requestedAtIso,
      changeRequest.decidedAtIso ?? null,
      changeRequest.decidedBy ?? null,
      changeRequest.decisionNote ?? null,
      changeRequest.updatedAtIso,
    ]),
  });
}

export function selectProjectChangeRequestsSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_change_requests
      WHERE project_request_id = $1
      ORDER BY requested_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectChangeRequestByIdSql(
  projectRequestId: string,
  changeRequestId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_change_requests
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, changeRequestId]),
  });
}

export function updateProjectChangeRequestDecisionSql(
  changeRequest: ProjectChangeRequest
): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_change_requests
      SET status = $3, decided_at = $4, decided_by = $5, decision_note = $6, updated_at = $7
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      changeRequest.projectRequestId,
      changeRequest.id,
      changeRequest.status,
      changeRequest.decidedAtIso ?? null,
      changeRequest.decidedBy ?? null,
      changeRequest.decisionNote ?? null,
      changeRequest.updatedAtIso,
    ]),
  });
}

export function insertProjectIssueSql(issue: ProjectIssue): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_issues (
      id,
      project_request_id,
      title,
      description,
      severity,
      owner,
      status,
      opened_at,
      resolved_at,
      resolution_note,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    params: Object.freeze([
      issue.id,
      issue.projectRequestId,
      issue.title,
      issue.description,
      issue.severity,
      issue.owner ?? null,
      issue.status,
      issue.openedAtIso,
      issue.resolvedAtIso ?? null,
      issue.resolutionNote ?? null,
      issue.updatedAtIso,
    ]),
  });
}

export function selectProjectIssuesSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_issues
      WHERE project_request_id = $1
      ORDER BY opened_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectIssueByIdSql(
  projectRequestId: string,
  issueId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_issues
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, issueId]),
  });
}

export function resolveProjectIssueSql(issue: ProjectIssue): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_issues
      SET status = $3, resolved_at = $4, resolution_note = $5, updated_at = $6
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      issue.projectRequestId,
      issue.id,
      issue.status,
      issue.resolvedAtIso ?? null,
      issue.resolutionNote ?? null,
      issue.updatedAtIso,
    ]),
  });
}

export function insertProjectFeedbackSql(feedback: ProjectFeedback): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_feedback (
      id,
      project_request_id,
      deliverable_id,
      author,
      sentiment,
      message,
      status,
      received_at,
      addressed_at,
      addressed_by,
      response_note,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    params: Object.freeze([
      feedback.id,
      feedback.projectRequestId,
      feedback.deliverableId ?? null,
      feedback.author,
      feedback.sentiment,
      feedback.message,
      feedback.status,
      feedback.receivedAtIso,
      feedback.addressedAtIso ?? null,
      feedback.addressedBy ?? null,
      feedback.responseNote ?? null,
      feedback.updatedAtIso,
    ]),
  });
}

export function selectProjectFeedbackSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_feedback
      WHERE project_request_id = $1
      ORDER BY received_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectFeedbackByIdSql(
  projectRequestId: string,
  feedbackId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_feedback
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, feedbackId]),
  });
}

export function addressProjectFeedbackSql(feedback: ProjectFeedback): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_feedback
      SET status = $3, addressed_at = $4, addressed_by = $5, response_note = $6, updated_at = $7
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      feedback.projectRequestId,
      feedback.id,
      feedback.status,
      feedback.addressedAtIso ?? null,
      feedback.addressedBy ?? null,
      feedback.responseNote ?? null,
      feedback.updatedAtIso,
    ]),
  });
}

export function insertProjectDocumentSql(document: ProjectDocument): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_documents (
      id,
      project_request_id,
      deliverable_id,
      title,
      document_type,
      url,
      status,
      uploaded_by,
      uploaded_at,
      archived_at,
      archived_by,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    params: Object.freeze([
      document.id,
      document.projectRequestId,
      document.deliverableId ?? null,
      document.title,
      document.documentType,
      document.url,
      document.status,
      document.uploadedBy,
      document.uploadedAtIso,
      document.archivedAtIso ?? null,
      document.archivedBy ?? null,
      document.updatedAtIso,
    ]),
  });
}

export function selectProjectDocumentsSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_documents
      WHERE project_request_id = $1
      ORDER BY uploaded_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectDocumentByIdSql(
  projectRequestId: string,
  documentId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_documents
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, documentId]),
  });
}

export function archiveProjectDocumentSql(document: ProjectDocument): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_documents
      SET status = $3, archived_at = $4, archived_by = $5, updated_at = $6
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      document.projectRequestId,
      document.id,
      document.status,
      document.archivedAtIso ?? null,
      document.archivedBy ?? null,
      document.updatedAtIso,
    ]),
  });
}

export function insertProjectNoteSql(note: ProjectNote): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_notes (
      id,
      project_request_id,
      author,
      visibility,
      body,
      status,
      created_at,
      archived_at,
      archived_by,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    params: Object.freeze([
      note.id,
      note.projectRequestId,
      note.author,
      note.visibility,
      note.body,
      note.status,
      note.createdAtIso,
      note.archivedAtIso ?? null,
      note.archivedBy ?? null,
      note.updatedAtIso,
    ]),
  });
}

export function selectProjectNotesSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_notes
      WHERE project_request_id = $1
      ORDER BY created_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectNoteByIdSql(
  projectRequestId: string,
  noteId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_notes
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, noteId]),
  });
}

export function archiveProjectNoteSql(note: ProjectNote): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_notes
      SET status = $3, archived_at = $4, archived_by = $5, updated_at = $6
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      note.projectRequestId,
      note.id,
      note.status,
      note.archivedAtIso ?? null,
      note.archivedBy ?? null,
      note.updatedAtIso,
    ]),
  });
}

export function insertProjectTaskSql(task: ProjectTask): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_tasks (
      id,
      project_request_id,
      title,
      description,
      assignee,
      priority,
      status,
      due_at,
      created_at,
      completed_at,
      completed_by,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    params: Object.freeze([
      task.id,
      task.projectRequestId,
      task.title,
      task.description ?? null,
      task.assignee ?? null,
      task.priority,
      task.status,
      task.dueAtIso ?? null,
      task.createdAtIso,
      task.completedAtIso ?? null,
      task.completedBy ?? null,
      task.updatedAtIso,
    ]),
  });
}

export function selectProjectTasksSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_tasks
      WHERE project_request_id = $1
      ORDER BY due_at ASC NULLS LAST, created_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectTaskByIdSql(
  projectRequestId: string,
  taskId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_tasks
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, taskId]),
  });
}

export function completeProjectTaskSql(task: ProjectTask): SqlStatement {
  return Object.freeze({
    sql: `UPDATE projectops_project_tasks
      SET status = $3, completed_at = $4, completed_by = $5, updated_at = $6
      WHERE project_request_id = $1 AND id = $2
      RETURNING *`,
    params: Object.freeze([
      task.projectRequestId,
      task.id,
      task.status,
      task.completedAtIso ?? null,
      task.completedBy ?? null,
      task.updatedAtIso,
    ]),
  });
}

export function insertProjectActivitySql(activity: ProjectActivity): SqlStatement {
  return Object.freeze({
    sql: `INSERT INTO projectops_project_activities (
      id,
      project_request_id,
      event_type,
      summary,
      actor,
      happened_at,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    params: Object.freeze([
      activity.id,
      activity.projectRequestId,
      activity.eventType,
      activity.summary,
      activity.actor ?? null,
      activity.happenedAtIso,
      activity.createdAtIso,
    ]),
  });
}

export function selectProjectActivitiesSql(projectRequestId: string): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_activities
      WHERE project_request_id = $1
      ORDER BY happened_at DESC, created_at DESC, id ASC`,
    params: Object.freeze([projectRequestId]),
  });
}

export function selectProjectActivityByIdSql(
  projectRequestId: string,
  activityId: string
): SqlStatement {
  return Object.freeze({
    sql: `SELECT *
      FROM projectops_project_activities
      WHERE project_request_id = $1 AND id = $2`,
    params: Object.freeze([projectRequestId, activityId]),
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
      COALESCE(ds.submitted_deliverables, 0) AS submitted_deliverable_count,
      COALESCE(ds.accepted_deliverables, 0) AS accepted_deliverable_count,
      COALESCE(inv.issued_invoices, 0) AS issued_invoice_count,
      COALESCE(inv.paid_invoices, 0) AS paid_invoice_count,
      COALESCE(inv.outstanding_amount_cents, 0) AS outstanding_invoice_amount_cents,
      COALESCE(inv.paid_amount_cents, 0) AS paid_invoice_amount_cents,
      COALESCE(ch.proposed_change_requests, 0) AS proposed_change_request_count,
      COALESCE(ch.approved_change_requests, 0) AS approved_change_request_count,
      COALESCE(ch.rejected_change_requests, 0) AS rejected_change_request_count,
      COALESCE(iss.open_issues, 0) AS open_issue_count,
      COALESCE(iss.high_open_issues, 0) AS high_open_issue_count,
      COALESCE(iss.resolved_issues, 0) AS resolved_issue_count,
      COALESCE(fb.open_feedback, 0) AS open_feedback_count,
      COALESCE(fb.addressed_feedback, 0) AS addressed_feedback_count,
      COALESCE(fb.negative_open_feedback, 0) AS negative_open_feedback_count,
      COALESCE(doc.active_documents, 0) AS active_document_count,
      COALESCE(doc.archived_documents, 0) AS archived_document_count,
      COALESCE(nt.active_notes, 0) AS active_note_count,
      COALESCE(nt.archived_notes, 0) AS archived_note_count,
      COALESCE(nt.client_visible_notes, 0) AS client_visible_note_count,
      COALESCE(ts.open_tasks, 0) AS open_task_count,
      COALESCE(ts.high_open_tasks, 0) AS high_open_task_count,
      COALESCE(ts.completed_tasks, 0) AS completed_task_count,
      ts.next_task_due_at,
      act.latest_activity_at,
      act.latest_activity_summary,
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
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'submitted') AS submitted_deliverables,
        COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_deliverables
      FROM projectops_project_deliverables
      GROUP BY project_request_id
    ) ds ON ds.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'issued') AS issued_invoices,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_invoices,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'issued'), 0) AS outstanding_amount_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_amount_cents
      FROM projectops_project_invoices
      GROUP BY project_request_id
    ) inv ON inv.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'proposed') AS proposed_change_requests,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_change_requests,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_change_requests
      FROM projectops_project_change_requests
      GROUP BY project_request_id
    ) ch ON ch.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_issues,
        COUNT(*) FILTER (WHERE status = 'open' AND severity = 'high') AS high_open_issues,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_issues
      FROM projectops_project_issues
      GROUP BY project_request_id
    ) iss ON iss.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_feedback,
        COUNT(*) FILTER (WHERE status = 'addressed') AS addressed_feedback,
        COUNT(*) FILTER (WHERE status = 'open' AND sentiment = 'negative') AS negative_open_feedback
      FROM projectops_project_feedback
      GROUP BY project_request_id
    ) fb ON fb.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'active') AS active_documents,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived_documents
      FROM projectops_project_documents
      GROUP BY project_request_id
    ) doc ON doc.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'active') AS active_notes,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived_notes,
        COUNT(*) FILTER (WHERE status = 'active' AND visibility = 'client') AS client_visible_notes
      FROM projectops_project_notes
      GROUP BY project_request_id
    ) nt ON nt.project_request_id = pr.id
    LEFT JOIN (
      SELECT
        project_request_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_tasks,
        COUNT(*) FILTER (WHERE status = 'open' AND priority = 'high') AS high_open_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_tasks,
        MIN(due_at) FILTER (WHERE status = 'open') AS next_task_due_at
      FROM projectops_project_tasks
      GROUP BY project_request_id
    ) ts ON ts.project_request_id = pr.id
    LEFT JOIN (
      SELECT DISTINCT ON (project_request_id)
        project_request_id,
        happened_at AS latest_activity_at,
        summary AS latest_activity_summary
      FROM projectops_project_activities
      ORDER BY project_request_id, happened_at DESC, created_at DESC, id ASC
    ) act ON act.project_request_id = pr.id
    WHERE pr.status != 'archived'
    ORDER BY pr.updated_at DESC, pr.created_at DESC`,
    params: Object.freeze([]),
  });
}
