import type { RawQueryResult } from '../../db/src/connection/connect.ts';
import { ProjectOpsOperationError } from './domain.ts';
import type { ProjectOpsSqlExecutor } from './repository.ts';
import type { SqlStatement } from './sql.ts';

type ProjectOpsTable =
  | 'projectops_clients'
  | 'projectops_project_requests'
  | 'projectops_project_milestones'
  | 'projectops_project_deliverables';

export interface ProjectOpsQueryConnection {
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<RawQueryResult<TRow>>;
}

export class ProjectOpsConnectionSqlExecutor implements ProjectOpsSqlExecutor {
  private readonly connection: ProjectOpsQueryConnection;

  constructor(connection: ProjectOpsQueryConnection) {
    this.connection = connection;
  }

  public async query<T>(statement: SqlStatement): Promise<readonly T[]> {
    try {
      const result = await this.connection.query<T>(statement.sql, statement.params);
      return Object.freeze(result.rows.map(normalizeProjectOpsRow) as T[]);
    } catch (error) {
      throw mapProjectOpsStorageError(error, statement);
    }
  }
}

export class ProjectOpsMemorySqlExecutor implements ProjectOpsSqlExecutor {
  private readonly clients = new Map<string, ProjectOpsClientRow>();
  private readonly projectRequests = new Map<string, ProjectOpsRequestRow>();
  private readonly projectMilestones = new Map<string, ProjectOpsMilestoneRow>();
  private readonly projectDeliverables = new Map<string, ProjectOpsDeliverableRow>();
  private readonly migratedTables = new Set<ProjectOpsTable>();

  public async query<T>(statement: SqlStatement): Promise<readonly T[]> {
    const sql = normalizeSql(statement.sql);
    const upper = sql.toUpperCase();

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_CLIENTS')) {
      this.migratedTables.add('projectops_clients');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_REQUESTS')) {
      this.migratedTables.add('projectops_project_requests');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_MILESTONES')) {
      this.migratedTables.add('projectops_project_milestones');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_DELIVERABLES')) {
      this.migratedTables.add('projectops_project_deliverables');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE INDEX IF NOT EXISTS PROJECTOPS_')) {
      this.assertMigrated();
      return Object.freeze([]);
    }

    this.assertMigrated();

    if (upper.startsWith('INSERT INTO PROJECTOPS_CLIENTS')) {
      const row = this.insertClient(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_REQUESTS')) {
      const row = this.insertProjectRequest(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_MILESTONES')) {
      const row = this.insertProjectMilestone(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_DELIVERABLES')) {
      const row = this.insertProjectDeliverable(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_CLIENTS ORDER BY CREATED_AT DESC')) {
      return Object.freeze(this.selectClients() as T[]);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_CLIENTS WHERE ID = $1')) {
      const id = String(statement.params[0]);
      const row = this.clients.get(id);
      return Object.freeze(row ? [toClient(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_REQUESTS ORDER BY UPDATED_AT DESC')) {
      return Object.freeze(this.selectProjectRequests() as T[]);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_REQUESTS WHERE ID = $1')) {
      const id = String(statement.params[0]);
      const row = this.projectRequests.get(id);
      return Object.freeze(row ? [toProjectRequest(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_MILESTONES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = milestoneKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectMilestones.get(key);
      return Object.freeze(row ? [toProjectMilestone(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_MILESTONES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectMilestones(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_MILESTONES')) {
      const row = this.completeProjectMilestone(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_DELIVERABLES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = deliverableKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectDeliverables.get(key);
      return Object.freeze(row ? [toProjectDeliverable(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_DELIVERABLES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectDeliverables(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_DELIVERABLES')) {
      const row = this.acceptProjectDeliverable(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_REQUESTS') && upper.includes('ESTIMATE_AMOUNT_CENTS')) {
      const row = this.estimateProjectRequest(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_REQUESTS') && upper.includes('APPROVED_AT')) {
      const row = this.approveProjectRequest(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_REQUESTS')) {
      const row = this.updateProjectRequestStatus(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.includes('FROM PROJECTOPS_PROJECT_REQUESTS PR JOIN PROJECTOPS_CLIENTS C')) {
      return Object.freeze(this.selectDashboardRows() as T[]);
    }

    throw new Error(`Unsupported ProjectOps SQL statement: ${statement.sql}`);
  }

  public snapshot(): Readonly<{
    clients: readonly ProjectOpsClientRow[];
    projectRequests: readonly ProjectOpsRequestRow[];
    projectMilestones: readonly ProjectOpsMilestoneRow[];
    projectDeliverables: readonly ProjectOpsDeliverableRow[];
  }> {
    return Object.freeze({
      clients: Object.freeze([...this.clients.values()].map((row) => Object.freeze({ ...row }))),
      projectRequests: Object.freeze(
        [...this.projectRequests.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectMilestones: Object.freeze(
        [...this.projectMilestones.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectDeliverables: Object.freeze(
        [...this.projectDeliverables.values()].map((row) => Object.freeze({ ...row }))
      ),
    });
  }

  private assertMigrated(): void {
    if (
      !this.migratedTables.has('projectops_clients') ||
      !this.migratedTables.has('projectops_project_requests') ||
      !this.migratedTables.has('projectops_project_milestones') ||
      !this.migratedTables.has('projectops_project_deliverables')
    ) {
      throw new Error('ProjectOps schema has not been migrated.');
    }
  }

  private insertClient(params: readonly unknown[]): ProjectOpsClientRow {
    const row = Object.freeze({
      id: asString(params[0], 'client.id'),
      name: asString(params[1], 'client.name'),
      contactName: asOptionalString(params[2]),
      email: asOptionalString(params[3]),
      status: asString(params[4], 'client.status'),
      createdAtIso: asString(params[5], 'client.createdAtIso'),
    } satisfies ProjectOpsClientRow);

    if (this.clients.has(row.id)) {
      throw new Error(`Duplicate ProjectOps client id: ${row.id}`);
    }
    this.clients.set(row.id, row);
    return row;
  }

  private insertProjectRequest(params: readonly unknown[]): ProjectOpsRequestRow {
    const clientId = asString(params[1], 'projectRequest.clientId');
    if (!this.clients.has(clientId)) {
      throw new Error(`ProjectOps client not found: ${clientId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectRequest.id'),
      clientId,
      title: asString(params[2], 'projectRequest.title'),
      brief: asString(params[3], 'projectRequest.brief'),
      budgetRange: asOptionalString(params[4]),
      deadlineIso: asOptionalString(params[5]),
      estimateAmountCents: asOptionalNumber(params[6]),
      estimateCurrency: asOptionalString(params[7]),
      estimatedAtIso: asOptionalString(params[8]),
      approvedAtIso: asOptionalString(params[9]),
      approvedBy: asOptionalString(params[10]),
      priority: asString(params[11], 'projectRequest.priority'),
      status: asString(params[12], 'projectRequest.status'),
      createdAtIso: asString(params[13], 'projectRequest.createdAtIso'),
      updatedAtIso: asString(params[14], 'projectRequest.updatedAtIso'),
    } satisfies ProjectOpsRequestRow);

    if (this.projectRequests.has(row.id)) {
      throw new Error(`Duplicate ProjectOps project request id: ${row.id}`);
    }
    this.projectRequests.set(row.id, row);
    return row;
  }

  private insertProjectMilestone(params: readonly unknown[]): ProjectOpsMilestoneRow {
    const projectRequestId = asString(params[1], 'projectMilestone.projectRequestId');
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectMilestone.id'),
      projectRequestId,
      title: asString(params[2], 'projectMilestone.title'),
      dueAtIso: asOptionalString(params[3]),
      status: asString(params[4], 'projectMilestone.status'),
      createdAtIso: asString(params[5], 'projectMilestone.createdAtIso'),
      completedAtIso: asOptionalString(params[6]),
      updatedAtIso: asString(params[7], 'projectMilestone.updatedAtIso'),
    } satisfies ProjectOpsMilestoneRow);

    const key = milestoneKey(projectRequestId, row.id);
    if (this.projectMilestones.has(key)) {
      throw new Error(`Duplicate ProjectOps project milestone id: ${projectRequestId}/${row.id}`);
    }
    this.projectMilestones.set(key, row);
    return row;
  }

  private insertProjectDeliverable(params: readonly unknown[]): ProjectOpsDeliverableRow {
    const projectRequestId = asString(params[1], 'projectDeliverable.projectRequestId');
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const milestoneId = asOptionalString(params[2]);
    if (milestoneId && !this.projectMilestones.has(milestoneKey(projectRequestId, milestoneId))) {
      throw new Error(`ProjectOps project milestone not found: ${projectRequestId}/${milestoneId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectDeliverable.id'),
      projectRequestId,
      milestoneId,
      title: asString(params[3], 'projectDeliverable.title'),
      artifactUrl: asString(params[4], 'projectDeliverable.artifactUrl'),
      status: asString(params[5], 'projectDeliverable.status'),
      submittedAtIso: asString(params[6], 'projectDeliverable.submittedAtIso'),
      acceptedAtIso: asOptionalString(params[7]),
      updatedAtIso: asString(params[8], 'projectDeliverable.updatedAtIso'),
    } satisfies ProjectOpsDeliverableRow);

    const key = deliverableKey(projectRequestId, row.id);
    if (this.projectDeliverables.has(key)) {
      throw new Error(`Duplicate ProjectOps project deliverable id: ${projectRequestId}/${row.id}`);
    }
    this.projectDeliverables.set(key, row);
    return row;
  }

  private estimateProjectRequest(params: readonly unknown[]): ProjectOpsRequestRow | undefined {
    const id = asString(params[0], 'projectRequest.id');
    const current = this.projectRequests.get(id);
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      estimateAmountCents: asOptionalNumber(params[1]),
      estimateCurrency: asOptionalString(params[2]),
      estimatedAtIso: asOptionalString(params[3]),
      status: asString(params[4], 'projectRequest.status'),
      updatedAtIso: asString(params[5], 'projectRequest.updatedAtIso'),
    });
    this.projectRequests.set(id, next);
    return next;
  }

  private approveProjectRequest(params: readonly unknown[]): ProjectOpsRequestRow | undefined {
    const id = asString(params[0], 'projectRequest.id');
    const current = this.projectRequests.get(id);
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      approvedAtIso: asOptionalString(params[1]),
      approvedBy: asOptionalString(params[2]),
      status: asString(params[3], 'projectRequest.status'),
      updatedAtIso: asString(params[4], 'projectRequest.updatedAtIso'),
    });
    this.projectRequests.set(id, next);
    return next;
  }

  private updateProjectRequestStatus(params: readonly unknown[]): ProjectOpsRequestRow | undefined {
    const id = asString(params[0], 'projectRequest.id');
    const current = this.projectRequests.get(id);
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[1], 'projectRequest.status'),
      updatedAtIso: asString(params[2], 'projectRequest.updatedAtIso'),
    });
    this.projectRequests.set(id, next);
    return next;
  }

  private completeProjectMilestone(params: readonly unknown[]): ProjectOpsMilestoneRow | undefined {
    const projectRequestId = asString(params[0], 'projectMilestone.projectRequestId');
    const id = asString(params[1], 'projectMilestone.id');
    const current = this.projectMilestones.get(milestoneKey(projectRequestId, id));
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectMilestone.status'),
      completedAtIso: asOptionalString(params[3]),
      updatedAtIso: asString(params[4], 'projectMilestone.updatedAtIso'),
    });
    this.projectMilestones.set(milestoneKey(projectRequestId, id), next);
    return next;
  }

  private acceptProjectDeliverable(params: readonly unknown[]): ProjectOpsDeliverableRow | undefined {
    const projectRequestId = asString(params[0], 'projectDeliverable.projectRequestId');
    const id = asString(params[1], 'projectDeliverable.id');
    const current = this.projectDeliverables.get(deliverableKey(projectRequestId, id));
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectDeliverable.status'),
      acceptedAtIso: asOptionalString(params[3]),
      updatedAtIso: asString(params[4], 'projectDeliverable.updatedAtIso'),
    });
    this.projectDeliverables.set(deliverableKey(projectRequestId, id), next);
    return next;
  }

  private selectClients(): readonly ProjectOpsClientRow[] {
    return Object.freeze(
      [...this.clients.values()]
        .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || a.id.localeCompare(b.id))
        .map(toClient)
    );
  }

  private selectProjectRequests(): readonly ProjectOpsRequestRow[] {
    return Object.freeze(
      [...this.projectRequests.values()]
        .sort((a, b) => (
          b.updatedAtIso.localeCompare(a.updatedAtIso) ||
          b.createdAtIso.localeCompare(a.createdAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectRequest)
    );
  }

  private selectProjectMilestones(projectRequestId: string): readonly ProjectOpsMilestoneRow[] {
    return Object.freeze(
      [...this.projectMilestones.values()]
        .filter((milestone) => milestone.projectRequestId === projectRequestId)
        .sort((a, b) => (
          compareOptionalIso(a.dueAtIso, b.dueAtIso) ||
          a.createdAtIso.localeCompare(b.createdAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectMilestone)
    );
  }

  private selectProjectDeliverables(projectRequestId: string): readonly ProjectOpsDeliverableRow[] {
    return Object.freeze(
      [...this.projectDeliverables.values()]
        .filter((deliverable) => deliverable.projectRequestId === projectRequestId)
        .sort((a, b) => b.submittedAtIso.localeCompare(a.submittedAtIso) || a.id.localeCompare(b.id))
        .map(toProjectDeliverable)
    );
  }

  private selectDashboardRows(): readonly ProjectOpsDashboardStorageRow[] {
    return Object.freeze(
      [...this.projectRequests.values()]
        .filter((request) => request.status !== 'archived')
        .sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso) || b.createdAtIso.localeCompare(a.createdAtIso))
        .map((request) => {
          const client = this.clients.get(request.clientId);
          if (!client) {
            throw new Error(`ProjectOps client not found: ${request.clientId}`);
          }

          return Object.freeze({
            id: request.id,
            clientId: request.clientId,
            clientName: client.name,
            title: request.title,
            priority: request.priority,
            status: request.status,
            deadlineIso: request.deadlineIso,
            estimateAmountCents: request.estimateAmountCents,
            estimateCurrency: request.estimateCurrency,
            estimatedAtIso: request.estimatedAtIso,
            approvedAtIso: request.approvedAtIso,
            approvedBy: request.approvedBy,
            openMilestoneCount: this.countMilestones(request.id, 'open'),
            completedMilestoneCount: this.countMilestones(request.id, 'completed'),
            submittedDeliverableCount: this.countDeliverables(request.id, 'submitted'),
            acceptedDeliverableCount: this.countDeliverables(request.id, 'accepted'),
            updatedAtIso: request.updatedAtIso,
          });
        })
    );
  }

  private countMilestones(projectRequestId: string, status: string): number {
    return [...this.projectMilestones.values()].filter(
      (milestone) => milestone.projectRequestId === projectRequestId && milestone.status === status
    ).length;
  }

  private countDeliverables(projectRequestId: string, status: string): number {
    return [...this.projectDeliverables.values()].filter(
      (deliverable) => deliverable.projectRequestId === projectRequestId && deliverable.status === status
    ).length;
  }
}

function toClient(row: ProjectOpsClientRow): ProjectOpsClientRow {
  return Object.freeze({ ...row });
}

function toProjectRequest(row: ProjectOpsRequestRow): ProjectOpsRequestRow {
  return Object.freeze({ ...row });
}

function toProjectMilestone(row: ProjectOpsMilestoneRow): ProjectOpsMilestoneRow {
  return Object.freeze({ ...row });
}

function toProjectDeliverable(row: ProjectOpsDeliverableRow): ProjectOpsDeliverableRow {
  return Object.freeze({ ...row });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function milestoneKey(projectRequestId: string, milestoneId: string): string {
  return `${projectRequestId}\0${milestoneId}`;
}

function deliverableKey(projectRequestId: string, deliverableId: string): string {
  return `${projectRequestId}\0${deliverableId}`;
}

function compareOptionalIso(a: string | undefined, b: string | undefined): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function normalizeProjectOpsRow<TRow>(row: TRow): TRow {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const source = row as Record<string, unknown>;
  return Object.freeze({
    ...source,
    ...(source.client_id !== undefined ? { clientId: source.client_id } : {}),
    ...(source.client_name !== undefined ? { clientName: source.client_name } : {}),
    ...(source.project_request_id !== undefined ? { projectRequestId: source.project_request_id } : {}),
    ...(source.milestone_id !== undefined ? { milestoneId: normalizeOptionalValue(source.milestone_id) } : {}),
    ...(source.contact_name !== undefined ? { contactName: source.contact_name } : {}),
    ...(source.created_at !== undefined ? { createdAtIso: normalizeIsoValue(source.created_at) } : {}),
    ...(source.updated_at !== undefined ? { updatedAtIso: normalizeIsoValue(source.updated_at) } : {}),
    ...(source.deadline_at !== undefined ? { deadlineIso: normalizeOptionalIsoValue(source.deadline_at) } : {}),
    ...(source.due_at !== undefined ? { dueAtIso: normalizeOptionalIsoValue(source.due_at) } : {}),
    ...(source.estimate_amount_cents !== undefined
      ? { estimateAmountCents: normalizeOptionalValue(source.estimate_amount_cents) }
      : {}),
    ...(source.estimate_currency !== undefined
      ? { estimateCurrency: normalizeOptionalValue(source.estimate_currency) }
      : {}),
    ...(source.estimated_at !== undefined
      ? { estimatedAtIso: normalizeOptionalIsoValue(source.estimated_at) }
      : {}),
    ...(source.approved_at !== undefined
      ? { approvedAtIso: normalizeOptionalIsoValue(source.approved_at) }
      : {}),
    ...(source.approved_by !== undefined ? { approvedBy: normalizeOptionalValue(source.approved_by) } : {}),
    ...(source.completed_at !== undefined
      ? { completedAtIso: normalizeOptionalIsoValue(source.completed_at) }
      : {}),
    ...(source.artifact_url !== undefined ? { artifactUrl: source.artifact_url } : {}),
    ...(source.submitted_at !== undefined
      ? { submittedAtIso: normalizeIsoValue(source.submitted_at) }
      : {}),
    ...(source.accepted_at !== undefined
      ? { acceptedAtIso: normalizeOptionalIsoValue(source.accepted_at) }
      : {}),
    ...(source.open_milestone_count !== undefined
      ? { openMilestoneCount: normalizeOptionalNumberValue(source.open_milestone_count) }
      : {}),
    ...(source.completed_milestone_count !== undefined
      ? { completedMilestoneCount: normalizeOptionalNumberValue(source.completed_milestone_count) }
      : {}),
    ...(source.submitted_deliverable_count !== undefined
      ? { submittedDeliverableCount: normalizeOptionalNumberValue(source.submitted_deliverable_count) }
      : {}),
    ...(source.accepted_deliverable_count !== undefined
      ? { acceptedDeliverableCount: normalizeOptionalNumberValue(source.accepted_deliverable_count) }
      : {}),
  }) as TRow;
}

function normalizeIsoValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeOptionalIsoValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  return normalizeIsoValue(value);
}

function normalizeOptionalValue(value: unknown): unknown {
  return value === null ? undefined : value;
}

function normalizeOptionalNumberValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return value;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${name} to be a non-empty string.`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Expected optional ProjectOps SQL value to be a string.');
  }
  return value;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'number') {
    throw new Error('Expected optional ProjectOps SQL value to be a number.');
  }
  return value;
}

function mapProjectOpsStorageError(error: unknown, statement: SqlStatement): unknown {
  const code = (error as { code?: unknown })?.code;
  if (code === '23505' && statement.sql.includes('projectops_clients')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_CLIENT_ALREADY_EXISTS',
      'ProjectOps client already exists.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_requests')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_REQUEST_ALREADY_EXISTS',
      'ProjectOps project request already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_requests')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_CLIENT_NOT_FOUND',
      'ProjectOps client not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_milestones')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_MILESTONE_ALREADY_EXISTS',
      'ProjectOps project milestone already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_milestones')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_deliverables')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_DELIVERABLE_ALREADY_EXISTS',
      'ProjectOps project deliverable already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_deliverables')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_DELIVERABLE_RELATION_NOT_FOUND',
      'Project deliverable relationship not found.'
    );
  }
  return error;
}

interface ProjectOpsClientRow {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly status: string;
  readonly createdAtIso: string;
}

interface ProjectOpsRequestRow {
  readonly id: string;
  readonly clientId: string;
  readonly title: string;
  readonly brief: string;
  readonly budgetRange?: string;
  readonly deadlineIso?: string;
  readonly estimateAmountCents?: number;
  readonly estimateCurrency?: string;
  readonly estimatedAtIso?: string;
  readonly approvedAtIso?: string;
  readonly approvedBy?: string;
  readonly priority: string;
  readonly status: string;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsMilestoneRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly dueAtIso?: string;
  readonly status: string;
  readonly createdAtIso: string;
  readonly completedAtIso?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsDeliverableRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly milestoneId?: string;
  readonly title: string;
  readonly artifactUrl: string;
  readonly status: string;
  readonly submittedAtIso: string;
  readonly acceptedAtIso?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsDashboardStorageRow {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly title: string;
  readonly priority: string;
  readonly status: string;
  readonly deadlineIso?: string;
  readonly estimateAmountCents?: number;
  readonly estimateCurrency?: string;
  readonly estimatedAtIso?: string;
  readonly approvedAtIso?: string;
  readonly approvedBy?: string;
  readonly openMilestoneCount?: number;
  readonly completedMilestoneCount?: number;
  readonly submittedDeliverableCount?: number;
  readonly acceptedDeliverableCount?: number;
  readonly updatedAtIso: string;
}
