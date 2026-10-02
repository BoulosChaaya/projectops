import type { RawQueryResult } from '../../db/src/connection/connect.ts';
import { ProjectOpsOperationError } from './domain.ts';
import type { ProjectOpsSqlExecutor } from './repository.ts';
import type { SqlStatement } from './sql.ts';

type ProjectOpsTable =
  | 'projectops_clients'
  | 'projectops_project_requests'
  | 'projectops_project_milestones'
  | 'projectops_project_deliverables'
  | 'projectops_project_invoices'
  | 'projectops_project_change_requests'
  | 'projectops_project_issues'
  | 'projectops_project_activities';

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
  private readonly projectInvoices = new Map<string, ProjectOpsInvoiceRow>();
  private readonly projectChangeRequests = new Map<string, ProjectOpsChangeRequestRow>();
  private readonly projectIssues = new Map<string, ProjectOpsIssueRow>();
  private readonly projectActivities = new Map<string, ProjectOpsActivityRow>();
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

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_INVOICES')) {
      this.migratedTables.add('projectops_project_invoices');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_CHANGE_REQUESTS')) {
      this.migratedTables.add('projectops_project_change_requests');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_ISSUES')) {
      this.migratedTables.add('projectops_project_issues');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_ACTIVITIES')) {
      this.migratedTables.add('projectops_project_activities');
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

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_INVOICES')) {
      const row = this.insertProjectInvoice(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_CHANGE_REQUESTS')) {
      const row = this.insertProjectChangeRequest(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_ISSUES')) {
      const row = this.insertProjectIssue(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_ACTIVITIES')) {
      const row = this.insertProjectActivity(statement.params);
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

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_INVOICES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = invoiceKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectInvoices.get(key);
      return Object.freeze(row ? [toProjectInvoice(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_INVOICES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectInvoices(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_INVOICES')) {
      const row = this.markProjectInvoicePaid(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_CHANGE_REQUESTS WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = changeRequestKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectChangeRequests.get(key);
      return Object.freeze(row ? [toProjectChangeRequest(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_CHANGE_REQUESTS WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectChangeRequests(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_CHANGE_REQUESTS')) {
      const row = this.updateProjectChangeRequestDecision(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_ISSUES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = issueKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectIssues.get(key);
      return Object.freeze(row ? [toProjectIssue(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_ISSUES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectIssues(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_ISSUES')) {
      const row = this.resolveProjectIssue(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_ACTIVITIES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = activityKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectActivities.get(key);
      return Object.freeze(row ? [toProjectActivity(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_ACTIVITIES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectActivities(projectRequestId) as T[]);
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
    projectInvoices: readonly ProjectOpsInvoiceRow[];
    projectChangeRequests: readonly ProjectOpsChangeRequestRow[];
    projectIssues: readonly ProjectOpsIssueRow[];
    projectActivities: readonly ProjectOpsActivityRow[];
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
      projectInvoices: Object.freeze(
        [...this.projectInvoices.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectChangeRequests: Object.freeze(
        [...this.projectChangeRequests.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectIssues: Object.freeze(
        [...this.projectIssues.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectActivities: Object.freeze(
        [...this.projectActivities.values()].map((row) => Object.freeze({ ...row }))
      ),
    });
  }

  private assertMigrated(): void {
    if (
      !this.migratedTables.has('projectops_clients') ||
      !this.migratedTables.has('projectops_project_requests') ||
      !this.migratedTables.has('projectops_project_milestones') ||
      !this.migratedTables.has('projectops_project_deliverables') ||
      !this.migratedTables.has('projectops_project_invoices') ||
      !this.migratedTables.has('projectops_project_change_requests') ||
      !this.migratedTables.has('projectops_project_issues') ||
      !this.migratedTables.has('projectops_project_activities')
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

  private insertProjectInvoice(params: readonly unknown[]): ProjectOpsInvoiceRow {
    const projectRequestId = asString(params[1], 'projectInvoice.projectRequestId');
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const deliverableId = asOptionalString(params[2]);
    if (deliverableId && !this.projectDeliverables.has(deliverableKey(projectRequestId, deliverableId))) {
      throw new Error(`ProjectOps project deliverable not found: ${projectRequestId}/${deliverableId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectInvoice.id'),
      projectRequestId,
      deliverableId,
      invoiceNumber: asString(params[3], 'projectInvoice.invoiceNumber'),
      amountCents: asNumber(params[4], 'projectInvoice.amountCents'),
      currency: asString(params[5], 'projectInvoice.currency'),
      status: asString(params[6], 'projectInvoice.status'),
      issuedAtIso: asString(params[7], 'projectInvoice.issuedAtIso'),
      dueAtIso: asOptionalString(params[8]),
      paidAtIso: asOptionalString(params[9]),
      updatedAtIso: asString(params[10], 'projectInvoice.updatedAtIso'),
    } satisfies ProjectOpsInvoiceRow);

    const key = invoiceKey(projectRequestId, row.id);
    if (this.projectInvoices.has(key)) {
      throw new Error(`Duplicate ProjectOps project invoice id: ${projectRequestId}/${row.id}`);
    }
    for (const invoice of this.projectInvoices.values()) {
      if (invoice.projectRequestId === projectRequestId && invoice.invoiceNumber === row.invoiceNumber) {
        throw new Error(`Duplicate ProjectOps project invoice number: ${projectRequestId}/${row.invoiceNumber}`);
      }
    }
    this.projectInvoices.set(key, row);
    return row;
  }

  private insertProjectChangeRequest(params: readonly unknown[]): ProjectOpsChangeRequestRow {
    const projectRequestId = asString(params[1], 'projectChangeRequest.projectRequestId');
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectChangeRequest.id'),
      projectRequestId,
      title: asString(params[2], 'projectChangeRequest.title'),
      description: asString(params[3], 'projectChangeRequest.description'),
      requestedBy: asString(params[4], 'projectChangeRequest.requestedBy'),
      estimateDeltaCents: asOptionalNumber(params[5]),
      estimateCurrency: asOptionalString(params[6]),
      status: asString(params[7], 'projectChangeRequest.status'),
      requestedAtIso: asString(params[8], 'projectChangeRequest.requestedAtIso'),
      decidedAtIso: asOptionalString(params[9]),
      decidedBy: asOptionalString(params[10]),
      decisionNote: asOptionalString(params[11]),
      updatedAtIso: asString(params[12], 'projectChangeRequest.updatedAtIso'),
    } satisfies ProjectOpsChangeRequestRow);

    const key = changeRequestKey(projectRequestId, row.id);
    if (this.projectChangeRequests.has(key)) {
      throw new Error(`Duplicate ProjectOps project change request id: ${projectRequestId}/${row.id}`);
    }
    this.projectChangeRequests.set(key, row);
    return row;
  }

  private insertProjectIssue(params: readonly unknown[]): ProjectOpsIssueRow {
    const projectRequestId = asString(params[1], 'projectIssue.projectRequestId');
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectIssue.id'),
      projectRequestId,
      title: asString(params[2], 'projectIssue.title'),
      description: asString(params[3], 'projectIssue.description'),
      severity: asString(params[4], 'projectIssue.severity'),
      owner: asOptionalString(params[5]),
      status: asString(params[6], 'projectIssue.status'),
      openedAtIso: asString(params[7], 'projectIssue.openedAtIso'),
      resolvedAtIso: asOptionalString(params[8]),
      resolutionNote: asOptionalString(params[9]),
      updatedAtIso: asString(params[10], 'projectIssue.updatedAtIso'),
    } satisfies ProjectOpsIssueRow);

    const key = issueKey(projectRequestId, row.id);
    if (this.projectIssues.has(key)) {
      throw new Error(`Duplicate ProjectOps project issue id: ${projectRequestId}/${row.id}`);
    }
    this.projectIssues.set(key, row);
    return row;
  }

  private insertProjectActivity(params: readonly unknown[]): ProjectOpsActivityRow {
    const projectRequestId = asString(params[1], 'projectActivity.projectRequestId');
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectActivity.id'),
      projectRequestId,
      eventType: asString(params[2], 'projectActivity.eventType'),
      summary: asString(params[3], 'projectActivity.summary'),
      actor: asOptionalString(params[4]),
      happenedAtIso: asString(params[5], 'projectActivity.happenedAtIso'),
      createdAtIso: asString(params[6], 'projectActivity.createdAtIso'),
    } satisfies ProjectOpsActivityRow);

    const key = activityKey(projectRequestId, row.id);
    if (this.projectActivities.has(key)) {
      throw new Error(`Duplicate ProjectOps project activity id: ${projectRequestId}/${row.id}`);
    }
    this.projectActivities.set(key, row);
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

  private markProjectInvoicePaid(params: readonly unknown[]): ProjectOpsInvoiceRow | undefined {
    const projectRequestId = asString(params[0], 'projectInvoice.projectRequestId');
    const id = asString(params[1], 'projectInvoice.id');
    const current = this.projectInvoices.get(invoiceKey(projectRequestId, id));
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectInvoice.status'),
      paidAtIso: asOptionalString(params[3]),
      updatedAtIso: asString(params[4], 'projectInvoice.updatedAtIso'),
    });
    this.projectInvoices.set(invoiceKey(projectRequestId, id), next);
    return next;
  }

  private updateProjectChangeRequestDecision(params: readonly unknown[]): ProjectOpsChangeRequestRow | undefined {
    const projectRequestId = asString(params[0], 'projectChangeRequest.projectRequestId');
    const id = asString(params[1], 'projectChangeRequest.id');
    const current = this.projectChangeRequests.get(changeRequestKey(projectRequestId, id));
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectChangeRequest.status'),
      decidedAtIso: asOptionalString(params[3]),
      decidedBy: asOptionalString(params[4]),
      decisionNote: asOptionalString(params[5]),
      updatedAtIso: asString(params[6], 'projectChangeRequest.updatedAtIso'),
    });
    this.projectChangeRequests.set(changeRequestKey(projectRequestId, id), next);
    return next;
  }

  private resolveProjectIssue(params: readonly unknown[]): ProjectOpsIssueRow | undefined {
    const projectRequestId = asString(params[0], 'projectIssue.projectRequestId');
    const id = asString(params[1], 'projectIssue.id');
    const current = this.projectIssues.get(issueKey(projectRequestId, id));
    if (!current) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectIssue.status'),
      resolvedAtIso: asOptionalString(params[3]),
      resolutionNote: asOptionalString(params[4]),
      updatedAtIso: asString(params[5], 'projectIssue.updatedAtIso'),
    });
    this.projectIssues.set(issueKey(projectRequestId, id), next);
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

  private selectProjectInvoices(projectRequestId: string): readonly ProjectOpsInvoiceRow[] {
    return Object.freeze(
      [...this.projectInvoices.values()]
        .filter((invoice) => invoice.projectRequestId === projectRequestId)
        .sort((a, b) => b.issuedAtIso.localeCompare(a.issuedAtIso) || a.id.localeCompare(b.id))
        .map(toProjectInvoice)
    );
  }

  private selectProjectChangeRequests(projectRequestId: string): readonly ProjectOpsChangeRequestRow[] {
    return Object.freeze(
      [...this.projectChangeRequests.values()]
        .filter((changeRequest) => changeRequest.projectRequestId === projectRequestId)
        .sort((a, b) => b.requestedAtIso.localeCompare(a.requestedAtIso) || a.id.localeCompare(b.id))
        .map(toProjectChangeRequest)
    );
  }

  private selectProjectIssues(projectRequestId: string): readonly ProjectOpsIssueRow[] {
    return Object.freeze(
      [...this.projectIssues.values()]
        .filter((issue) => issue.projectRequestId === projectRequestId)
        .sort((a, b) => b.openedAtIso.localeCompare(a.openedAtIso) || a.id.localeCompare(b.id))
        .map(toProjectIssue)
    );
  }

  private selectProjectActivities(projectRequestId: string): readonly ProjectOpsActivityRow[] {
    return Object.freeze(
      [...this.projectActivities.values()]
        .filter((activity) => activity.projectRequestId === projectRequestId)
        .sort((a, b) => (
          b.happenedAtIso.localeCompare(a.happenedAtIso) ||
          b.createdAtIso.localeCompare(a.createdAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectActivity)
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
            issuedInvoiceCount: this.countInvoices(request.id, 'issued'),
            paidInvoiceCount: this.countInvoices(request.id, 'paid'),
            outstandingInvoiceAmountCents: this.sumInvoices(request.id, 'issued'),
            paidInvoiceAmountCents: this.sumInvoices(request.id, 'paid'),
            proposedChangeRequestCount: this.countChangeRequests(request.id, 'proposed'),
            approvedChangeRequestCount: this.countChangeRequests(request.id, 'approved'),
            rejectedChangeRequestCount: this.countChangeRequests(request.id, 'rejected'),
            openIssueCount: this.countIssues(request.id, 'open'),
            highOpenIssueCount: this.countHighOpenIssues(request.id),
            resolvedIssueCount: this.countIssues(request.id, 'resolved'),
            latestActivityAtIso: this.latestActivity(request.id)?.happenedAtIso,
            latestActivitySummary: this.latestActivity(request.id)?.summary,
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

  private countInvoices(projectRequestId: string, status: string): number {
    return [...this.projectInvoices.values()].filter(
      (invoice) => invoice.projectRequestId === projectRequestId && invoice.status === status
    ).length;
  }

  private sumInvoices(projectRequestId: string, status: string): number {
    return [...this.projectInvoices.values()]
      .filter((invoice) => invoice.projectRequestId === projectRequestId && invoice.status === status)
      .reduce((total, invoice) => total + invoice.amountCents, 0);
  }

  private countChangeRequests(projectRequestId: string, status: string): number {
    return [...this.projectChangeRequests.values()].filter(
      (changeRequest) => changeRequest.projectRequestId === projectRequestId && changeRequest.status === status
    ).length;
  }

  private countIssues(projectRequestId: string, status: string): number {
    return [...this.projectIssues.values()].filter(
      (issue) => issue.projectRequestId === projectRequestId && issue.status === status
    ).length;
  }

  private countHighOpenIssues(projectRequestId: string): number {
    return [...this.projectIssues.values()].filter(
      (issue) => issue.projectRequestId === projectRequestId && issue.status === 'open' && issue.severity === 'high'
    ).length;
  }

  private latestActivity(projectRequestId: string): ProjectOpsActivityRow | undefined {
    return this.selectProjectActivities(projectRequestId)[0];
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

function toProjectInvoice(row: ProjectOpsInvoiceRow): ProjectOpsInvoiceRow {
  return Object.freeze({ ...row });
}

function toProjectChangeRequest(row: ProjectOpsChangeRequestRow): ProjectOpsChangeRequestRow {
  return Object.freeze({ ...row });
}

function toProjectIssue(row: ProjectOpsIssueRow): ProjectOpsIssueRow {
  return Object.freeze({ ...row });
}

function toProjectActivity(row: ProjectOpsActivityRow): ProjectOpsActivityRow {
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

function invoiceKey(projectRequestId: string, invoiceId: string): string {
  return `${projectRequestId}\0${invoiceId}`;
}

function changeRequestKey(projectRequestId: string, changeRequestId: string): string {
  return `${projectRequestId}\0${changeRequestId}`;
}

function issueKey(projectRequestId: string, issueId: string): string {
  return `${projectRequestId}\0${issueId}`;
}

function activityKey(projectRequestId: string, activityId: string): string {
  return `${projectRequestId}\0${activityId}`;
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
    ...(source.deliverable_id !== undefined ? { deliverableId: normalizeOptionalValue(source.deliverable_id) } : {}),
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
    ...(source.invoice_number !== undefined ? { invoiceNumber: source.invoice_number } : {}),
    ...(source.amount_cents !== undefined ? { amountCents: normalizeOptionalNumberValue(source.amount_cents) } : {}),
    ...(source.issued_at !== undefined ? { issuedAtIso: normalizeIsoValue(source.issued_at) } : {}),
    ...(source.due_at !== undefined ? { dueAtIso: normalizeOptionalIsoValue(source.due_at) } : {}),
    ...(source.paid_at !== undefined ? { paidAtIso: normalizeOptionalIsoValue(source.paid_at) } : {}),
    ...(source.requested_by !== undefined ? { requestedBy: source.requested_by } : {}),
    ...(source.estimate_delta_cents !== undefined
      ? { estimateDeltaCents: normalizeOptionalNumberValue(source.estimate_delta_cents) }
      : {}),
    ...(source.requested_at !== undefined ? { requestedAtIso: normalizeIsoValue(source.requested_at) } : {}),
    ...(source.decided_at !== undefined
      ? { decidedAtIso: normalizeOptionalIsoValue(source.decided_at) }
      : {}),
    ...(source.decided_by !== undefined ? { decidedBy: normalizeOptionalValue(source.decided_by) } : {}),
    ...(source.decision_note !== undefined ? { decisionNote: normalizeOptionalValue(source.decision_note) } : {}),
    ...(source.opened_at !== undefined ? { openedAtIso: normalizeIsoValue(source.opened_at) } : {}),
    ...(source.resolved_at !== undefined
      ? { resolvedAtIso: normalizeOptionalIsoValue(source.resolved_at) }
      : {}),
    ...(source.resolution_note !== undefined ? { resolutionNote: normalizeOptionalValue(source.resolution_note) } : {}),
    ...(source.event_type !== undefined ? { eventType: source.event_type } : {}),
    ...(source.happened_at !== undefined ? { happenedAtIso: normalizeIsoValue(source.happened_at) } : {}),
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
    ...(source.issued_invoice_count !== undefined
      ? { issuedInvoiceCount: normalizeOptionalNumberValue(source.issued_invoice_count) }
      : {}),
    ...(source.paid_invoice_count !== undefined
      ? { paidInvoiceCount: normalizeOptionalNumberValue(source.paid_invoice_count) }
      : {}),
    ...(source.outstanding_invoice_amount_cents !== undefined
      ? { outstandingInvoiceAmountCents: normalizeOptionalNumberValue(source.outstanding_invoice_amount_cents) }
      : {}),
    ...(source.paid_invoice_amount_cents !== undefined
      ? { paidInvoiceAmountCents: normalizeOptionalNumberValue(source.paid_invoice_amount_cents) }
      : {}),
    ...(source.proposed_change_request_count !== undefined
      ? { proposedChangeRequestCount: normalizeOptionalNumberValue(source.proposed_change_request_count) }
      : {}),
    ...(source.approved_change_request_count !== undefined
      ? { approvedChangeRequestCount: normalizeOptionalNumberValue(source.approved_change_request_count) }
      : {}),
    ...(source.rejected_change_request_count !== undefined
      ? { rejectedChangeRequestCount: normalizeOptionalNumberValue(source.rejected_change_request_count) }
      : {}),
    ...(source.open_issue_count !== undefined
      ? { openIssueCount: normalizeOptionalNumberValue(source.open_issue_count) }
      : {}),
    ...(source.high_open_issue_count !== undefined
      ? { highOpenIssueCount: normalizeOptionalNumberValue(source.high_open_issue_count) }
      : {}),
    ...(source.resolved_issue_count !== undefined
      ? { resolvedIssueCount: normalizeOptionalNumberValue(source.resolved_issue_count) }
      : {}),
    ...(source.latest_activity_at !== undefined
      ? { latestActivityAtIso: normalizeOptionalIsoValue(source.latest_activity_at) }
      : {}),
    ...(source.latest_activity_summary !== undefined
      ? { latestActivitySummary: normalizeOptionalValue(source.latest_activity_summary) }
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

function asNumber(value: unknown, name: string): number {
  if (typeof value !== 'number') {
    throw new Error(`Expected ${name} to be a number.`);
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
  if (code === '23505' && statement.sql.includes('projectops_project_invoices')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_INVOICE_ALREADY_EXISTS',
      'ProjectOps project invoice already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_invoices')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_INVOICE_RELATION_NOT_FOUND',
      'Project invoice relationship not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_change_requests')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_CHANGE_REQUEST_ALREADY_EXISTS',
      'ProjectOps project change request already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_change_requests')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_issues')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_ISSUE_ALREADY_EXISTS',
      'ProjectOps project issue already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_issues')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_activities')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_ACTIVITY_ALREADY_EXISTS',
      'ProjectOps project activity already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_activities')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
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

interface ProjectOpsInvoiceRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly invoiceNumber: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly status: string;
  readonly issuedAtIso: string;
  readonly dueAtIso?: string;
  readonly paidAtIso?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsChangeRequestRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly requestedBy: string;
  readonly estimateDeltaCents?: number;
  readonly estimateCurrency?: string;
  readonly status: string;
  readonly requestedAtIso: string;
  readonly decidedAtIso?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsIssueRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: string;
  readonly owner?: string;
  readonly status: string;
  readonly openedAtIso: string;
  readonly resolvedAtIso?: string;
  readonly resolutionNote?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsActivityRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly eventType: string;
  readonly summary: string;
  readonly actor?: string;
  readonly happenedAtIso: string;
  readonly createdAtIso: string;
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
  readonly issuedInvoiceCount?: number;
  readonly paidInvoiceCount?: number;
  readonly outstandingInvoiceAmountCents?: number;
  readonly paidInvoiceAmountCents?: number;
  readonly proposedChangeRequestCount?: number;
  readonly approvedChangeRequestCount?: number;
  readonly rejectedChangeRequestCount?: number;
  readonly openIssueCount?: number;
  readonly highOpenIssueCount?: number;
  readonly resolvedIssueCount?: number;
  readonly latestActivityAtIso?: string;
  readonly latestActivitySummary?: string;
  readonly updatedAtIso: string;
}
