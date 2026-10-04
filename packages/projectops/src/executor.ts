import { compareIdentity, dashboardSearchText, type DashboardDueItem } from './dashboard.ts';
import { totalProjectFinances, type ProjectFinanceTotalsByCurrency } from './finances.ts';
import type { RawQueryResult } from '../../db/src/connection/connect.ts';
import { financeParentStates, ProjectOpsOperationError } from './domain.ts';
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
  | 'projectops_project_risks'
  | 'projectops_project_feedback'
  | 'projectops_project_documents'
  | 'projectops_project_notes'
  | 'projectops_project_tasks'
  | 'projectops_project_work_logs'
  | 'projectops_project_expenses'
  | 'projectops_project_activities';

export interface ProjectOpsQueryConnection {
  transaction?<T>(run: (connection: ProjectOpsQueryConnection) => Promise<T>): Promise<T>;
  query<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<RawQueryResult<TRow>>;
}

/** Lease one connection for the complete callback; pool.query cannot provide transaction affinity. */
export function projectOpsPoolConnection(pool: {
  query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null; command: string }>;
  connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null; command: string }>; release(): void }>;
}): ProjectOpsQueryConnection {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const result = await pool.query(sql, [...params]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command };
    },
    async transaction<T>(run: (connection: ProjectOpsQueryConnection) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await run({ async query<T>(sql: string, params: readonly unknown[] = []) {
          const result = await client.query(sql, [...params]);
          return { rows: result.rows as T[], rowCount: result.rowCount ?? 0, command: result.command };
        } });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}

export class ProjectOpsConnectionSqlExecutor implements ProjectOpsSqlExecutor {
  private readonly connection: ProjectOpsQueryConnection;
  private readonly inTransaction: boolean;

  constructor(connection: ProjectOpsQueryConnection, inTransaction = false) {
    this.connection = connection;
    this.inTransaction = inTransaction;
  }

  public async transaction<T>(run: (sql: ProjectOpsSqlExecutor) => Promise<T>): Promise<T> {
    // Composition joins the leased connection; an error propagates to its outer rollback.
    if (this.inTransaction) return await run(this);
    if (!this.connection.transaction) throw new Error('ProjectOps connection must support transaction affinity.');
    return await this.connection.transaction(connection => run(new ProjectOpsConnectionSqlExecutor(connection, true)));
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
  private pending: Promise<unknown> = Promise.resolve();
  private readonly clients = new Map<string, ProjectOpsClientRow>();
  private readonly projectRequests = new Map<string, ProjectOpsRequestRow>();
  private readonly projectMilestones = new Map<string, ProjectOpsMilestoneRow>();
  private readonly projectDeliverables = new Map<string, ProjectOpsDeliverableRow>();
  private readonly projectInvoices = new Map<string, ProjectOpsInvoiceRow>();
  private readonly projectChangeRequests = new Map<string, ProjectOpsChangeRequestRow>();
  private readonly projectIssues = new Map<string, ProjectOpsIssueRow>();
  private readonly projectRisks = new Map<string, ProjectOpsRiskRow>();
  private readonly projectFeedback = new Map<string, ProjectOpsFeedbackRow>();
  private readonly projectDocuments = new Map<string, ProjectOpsDocumentRow>();
  private readonly projectNotes = new Map<string, ProjectOpsNoteRow>();
  private readonly projectTasks = new Map<string, ProjectOpsTaskRow>();
  private readonly projectWorkLogs = new Map<string, ProjectOpsWorkLogRow>();
  private readonly projectExpenses = new Map<string, ProjectOpsExpenseRow>();
  private readonly projectActivities = new Map<string, ProjectOpsActivityRow>();
  private readonly migratedTables = new Set<ProjectOpsTable>();

  public async query<T>(statement: SqlStatement): Promise<readonly T[]> {
    return await this.serialized(() => this.execute<T>(statement));
  }

  public async transaction<T>(run: (sql: ProjectOpsSqlExecutor) => Promise<T>): Promise<T> {
    return await this.serialized(async () => {
      const maps = Object.values(this).filter(value => value instanceof Map) as Map<string, unknown>[];
      const snapshots = maps.map(map => new Map(map));
      const scoped: ProjectOpsSqlExecutor = {
        query: <TRow>(statement: SqlStatement) => this.execute<TRow>(statement),
        transaction: async <TResult>(nested: (sql: ProjectOpsSqlExecutor) => Promise<TResult>) => await nested(scoped),
      };
      try { return await run(scoped); }
      catch (error) {
        maps.forEach((map, index) => { map.clear(); for (const [key, value] of snapshots[index]!) map.set(key, value); });
        throw error;
      }
    });
  }

  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const result = this.pending.then(run);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(statement: SqlStatement): Promise<readonly T[]> {
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

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_RISKS')) {
      this.migratedTables.add('projectops_project_risks');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_FEEDBACK')) {
      this.migratedTables.add('projectops_project_feedback');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_DOCUMENTS')) {
      this.migratedTables.add('projectops_project_documents');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_NOTES')) {
      this.migratedTables.add('projectops_project_notes');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_TASKS')) {
      this.migratedTables.add('projectops_project_tasks');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_WORK_LOGS')) {
      this.migratedTables.add('projectops_project_work_logs');
      return Object.freeze([]);
    }

    if (upper.startsWith('CREATE TABLE IF NOT EXISTS PROJECTOPS_PROJECT_EXPENSES')) {
      this.migratedTables.add('projectops_project_expenses');
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
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_DELIVERABLES')) {
      const row = this.insertProjectDeliverable(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_INVOICES')) {
      const row = this.insertProjectInvoice(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_CHANGE_REQUESTS')) {
      const row = this.insertProjectChangeRequest(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_ISSUES')) {
      const row = this.insertProjectIssue(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_RISKS')) {
      const row = this.insertProjectRisk(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_FEEDBACK')) {
      const row = this.insertProjectFeedback(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_DOCUMENTS')) {
      const row = this.insertProjectDocument(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_NOTES')) {
      const row = this.insertProjectNote(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_TASKS')) {
      const row = this.insertProjectTask(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_WORK_LOGS')) {
      const row = this.insertProjectWorkLog(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_EXPENSES')) {
      const row = this.insertProjectExpense(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('INSERT INTO PROJECTOPS_PROJECT_ACTIVITIES')) {
      const row = this.insertProjectActivity(statement.params);
      return Object.freeze([row as T]);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_CLIENTS WHERE ($1')) {
      const [status, query] = statement.params.map(String);
      return Object.freeze(this.selectClients().filter(row =>
        (status === 'all' || row.status === status) && `${row.name} ${row.contactName ?? ''} ${row.email ?? ''}`.toLowerCase().includes(query)
      ) as T[]);
    }
    if (upper.startsWith('UPDATE PROJECTOPS_CLIENTS SET')) {
      const id = String(statement.params[0]);
      const row = this.clients.get(id);
      const archive = upper.includes("SET STATUS = 'ARCHIVED'");
      const revision = Number(statement.params[archive ? 1 : 4]);
      if (!row || row.status !== 'active' || (row.revision ?? 1) !== revision) return Object.freeze([]);
      const updated = Object.freeze(archive ? { ...row, status: 'archived', revision: revision + 1 } : {
        ...row, name: String(statement.params[1]), contactName: statement.params[2] == null ? undefined : String(statement.params[2]),
        email: statement.params[3] == null ? undefined : String(statement.params[3]), revision: revision + 1,
      });
      this.clients.set(id, updated);
      return Object.freeze([toClient(updated) as T]);
    }
    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_REQUESTS WHERE CLIENT_ID = $1')) {
      return Object.freeze(this.selectProjectRequests().filter(row => row.clientId === statement.params[0]) as T[]);
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
      const row = this.mutateProjectMilestone(statement.params, upper);
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

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_RISKS WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = riskKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectRisks.get(key);
      return Object.freeze(row ? [toProjectRisk(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_RISKS WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectRisks(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_RISKS')) {
      const row = this.mitigateProjectRisk(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_FEEDBACK WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = feedbackKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectFeedback.get(key);
      return Object.freeze(row ? [toProjectFeedback(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_FEEDBACK WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectFeedback(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_FEEDBACK')) {
      const row = this.addressProjectFeedback(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_DOCUMENTS WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = documentKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectDocuments.get(key);
      return Object.freeze(row ? [toProjectDocument(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_DOCUMENTS WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectDocuments(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_DOCUMENTS')) {
      const row = this.archiveProjectDocument(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_NOTES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = noteKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectNotes.get(key);
      return Object.freeze(row ? [toProjectNote(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_NOTES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectNotes(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_NOTES')) {
      const row = this.archiveProjectNote(statement.params);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_TASKS WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = taskKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectTasks.get(key);
      return Object.freeze(row ? [toProjectTask(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_TASKS WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectTasks(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_TASKS')) {
      const row = this.mutateProjectTask(statement.params, upper);
      return Object.freeze(row ? [row as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_WORK_LOGS WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = workLogKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectWorkLogs.get(key);
      return Object.freeze(row ? [toProjectWorkLog(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_WORK_LOGS WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectWorkLogs(projectRequestId) as T[]);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_EXPENSES WHERE PROJECT_REQUEST_ID = $1 AND ID = $2')) {
      const key = expenseKey(String(statement.params[0]), String(statement.params[1]));
      const row = this.projectExpenses.get(key);
      return Object.freeze(row ? [toProjectExpense(row) as T] : []);
    }

    if (upper.startsWith('SELECT * FROM PROJECTOPS_PROJECT_EXPENSES WHERE PROJECT_REQUEST_ID = $1')) {
      const projectRequestId = String(statement.params[0]);
      return Object.freeze(this.selectProjectExpenses(projectRequestId) as T[]);
    }

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_EXPENSES')) {
      const row = this.updateProjectExpenseDecision(statement.params);
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

    if (upper.startsWith('UPDATE PROJECTOPS_PROJECT_REQUESTS SET TITLE = $2')) {
      const id = String(statement.params[0]); const current = this.projectRequests.get(id);
      const revision = Number(statement.params[7]);
      if (!current || ['archived', 'cancelled'].includes(current.status) || (current.revision ?? 1) !== revision) return Object.freeze([]);
      const next = Object.freeze({ ...current, title: String(statement.params[1]), brief: String(statement.params[2]),
        budgetRange: asOptionalString(statement.params[3]), deadlineIso: asOptionalString(statement.params[4]),
        priority: String(statement.params[5]), updatedAtIso: String(statement.params[6]), revision: revision + 1 });
      this.projectRequests.set(id, next); return Object.freeze([next as T]);
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
      return Object.freeze(this.selectDashboardRows(statement.params) as T[]);
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
    projectRisks: readonly ProjectOpsRiskRow[];
    projectFeedback: readonly ProjectOpsFeedbackRow[];
    projectDocuments: readonly ProjectOpsDocumentRow[];
    projectNotes: readonly ProjectOpsNoteRow[];
    projectTasks: readonly ProjectOpsTaskRow[];
    projectWorkLogs: readonly ProjectOpsWorkLogRow[];
    projectExpenses: readonly ProjectOpsExpenseRow[];
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
      projectRisks: Object.freeze(
        [...this.projectRisks.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectFeedback: Object.freeze(
        [...this.projectFeedback.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectDocuments: Object.freeze(
        [...this.projectDocuments.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectNotes: Object.freeze(
        [...this.projectNotes.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectTasks: Object.freeze(
        [...this.projectTasks.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectWorkLogs: Object.freeze(
        [...this.projectWorkLogs.values()].map((row) => Object.freeze({ ...row }))
      ),
      projectExpenses: Object.freeze(
        [...this.projectExpenses.values()].map((row) => Object.freeze({ ...row }))
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
      !this.migratedTables.has('projectops_project_risks') ||
      !this.migratedTables.has('projectops_project_feedback') ||
      !this.migratedTables.has('projectops_project_documents') ||
      !this.migratedTables.has('projectops_project_notes') ||
      !this.migratedTables.has('projectops_project_tasks') ||
      !this.migratedTables.has('projectops_project_work_logs') ||
      !this.migratedTables.has('projectops_project_expenses') ||
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
      revision: 1,
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
    if (this.clients.get(clientId)!.status !== 'active') {
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_CLIENT_ARCHIVED', 'Archived clients cannot receive new projects.');
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
      revision: 1,
    } satisfies ProjectOpsRequestRow);

    if (this.projectRequests.has(row.id)) {
      throw new Error(`Duplicate ProjectOps project request id: ${row.id}`);
    }
    this.projectRequests.set(row.id, row);
    return row;
  }

  private insertProjectMilestone(params: readonly unknown[]): ProjectOpsMilestoneRow | undefined {
    const projectRequestId = asString(params[1], 'projectMilestone.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (!['approved', 'in_progress'].includes(parent.status)) return undefined;

    const row = Object.freeze({
      id: asString(params[0], 'projectMilestone.id'),
      projectRequestId,
      title: asString(params[2], 'projectMilestone.title'),
      dueAtIso: asOptionalString(params[3]),
      status: asString(params[4], 'projectMilestone.status'),
      createdAtIso: asString(params[5], 'projectMilestone.createdAtIso'),
      completedAtIso: asOptionalString(params[6]),
      updatedAtIso: asString(params[7], 'projectMilestone.updatedAtIso'),
      revision: asNumber(params[8], 'projectMilestone.revision'),
    } satisfies ProjectOpsMilestoneRow);

    const key = milestoneKey(projectRequestId, row.id);
    if (this.projectMilestones.has(key)) {
      throw new Error(`Duplicate ProjectOps project milestone id: ${projectRequestId}/${row.id}`);
    }
    this.projectMilestones.set(key, row);
    return row;
  }

  private insertProjectDeliverable(params: readonly unknown[]): ProjectOpsDeliverableRow | undefined {
    const projectRequestId = asString(params[1], 'projectDeliverable.projectRequestId');
    if (!['approved', 'in_progress'].includes(this.projectRequests.get(projectRequestId)?.status ?? '')) return undefined;
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
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_DELIVERABLE_ALREADY_EXISTS', `Project deliverable already exists: ${row.id}.`);
    }
    this.projectDeliverables.set(key, row);
    return row;
  }

  private insertProjectInvoice(params: readonly unknown[]): ProjectOpsInvoiceRow | undefined {
    const projectRequestId = asString(params[1], 'projectInvoice.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent || !(financeParentStates.issue as readonly string[]).includes(parent.status)) return undefined;

    const deliverableId = asOptionalString(params[2]);
    if (deliverableId && this.projectDeliverables.get(deliverableKey(projectRequestId, deliverableId))?.status !== 'accepted') return undefined;

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
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_INVOICE_ALREADY_EXISTS', `Duplicate ProjectOps project invoice id: ${projectRequestId}/${row.id}`);
    }
    for (const invoice of this.projectInvoices.values()) {
      if (invoice.projectRequestId === projectRequestId && invoice.invoiceNumber === row.invoiceNumber) {
        throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_INVOICE_ALREADY_EXISTS', `Duplicate ProjectOps project invoice number: ${projectRequestId}/${row.invoiceNumber}`);
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

  private insertProjectIssue(params: readonly unknown[]): ProjectOpsIssueRow | undefined {
    const projectRequestId = asString(params[1], 'projectIssue.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (!['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(parent.status)) return undefined;

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

  private insertProjectRisk(params: readonly unknown[]): ProjectOpsRiskRow | undefined {
    const projectRequestId = asString(params[1], 'projectRisk.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (!['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(parent.status)) return undefined;

    const row = Object.freeze({
      id: asString(params[0], 'projectRisk.id'),
      projectRequestId,
      title: asString(params[2], 'projectRisk.title'),
      description: asString(params[3], 'projectRisk.description'),
      probability: asString(params[4], 'projectRisk.probability'),
      impact: asString(params[5], 'projectRisk.impact'),
      mitigationPlan: asOptionalString(params[6]),
      owner: asOptionalString(params[7]),
      status: asString(params[8], 'projectRisk.status'),
      identifiedAtIso: asString(params[9], 'projectRisk.identifiedAtIso'),
      mitigatedAtIso: asOptionalString(params[10]),
      mitigationNote: asOptionalString(params[11]),
      updatedAtIso: asString(params[12], 'projectRisk.updatedAtIso'),
    } satisfies ProjectOpsRiskRow);

    const key = riskKey(projectRequestId, row.id);
    if (this.projectRisks.has(key)) {
      throw new Error(`Duplicate ProjectOps project risk id: ${projectRequestId}/${row.id}`);
    }
    this.projectRisks.set(key, row);
    return row;
  }

  private insertProjectFeedback(params: readonly unknown[]): ProjectOpsFeedbackRow | undefined {
    const projectRequestId = asString(params[1], 'projectFeedback.projectRequestId');
    if (!['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(this.projectRequests.get(projectRequestId)?.status ?? '')) return undefined;
    if (!this.projectRequests.has(projectRequestId)) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }

    const deliverableId = asOptionalString(params[2]);
    if (deliverableId && !this.projectDeliverables.has(deliverableKey(projectRequestId, deliverableId))) {
      throw new Error(`ProjectOps project deliverable not found: ${projectRequestId}/${deliverableId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectFeedback.id'),
      projectRequestId,
      deliverableId,
      author: asString(params[3], 'projectFeedback.author'),
      sentiment: asString(params[4], 'projectFeedback.sentiment'),
      message: asString(params[5], 'projectFeedback.message'),
      status: asString(params[6], 'projectFeedback.status'),
      receivedAtIso: asString(params[7], 'projectFeedback.receivedAtIso'),
      addressedAtIso: asOptionalString(params[8]),
      addressedBy: asOptionalString(params[9]),
      responseNote: asOptionalString(params[10]),
      updatedAtIso: asString(params[11], 'projectFeedback.updatedAtIso'),
    } satisfies ProjectOpsFeedbackRow);

    const key = feedbackKey(projectRequestId, row.id);
    if (this.projectFeedback.has(key)) {
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_FEEDBACK_ALREADY_EXISTS', `Project feedback already exists: ${row.id}.`);
    }
    this.projectFeedback.set(key, row);
    return row;
  }

  private insertProjectDocument(params: readonly unknown[]): ProjectOpsDocumentRow | undefined {
    const projectRequestId = asString(params[1], 'projectDocument.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (!['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(parent.status)) return undefined;

    const deliverableId = asOptionalString(params[2]);
    if (deliverableId && !this.projectDeliverables.has(deliverableKey(projectRequestId, deliverableId))) {
      throw new Error(`ProjectOps project deliverable not found: ${projectRequestId}/${deliverableId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectDocument.id'),
      projectRequestId,
      deliverableId,
      title: asString(params[3], 'projectDocument.title'),
      documentType: asString(params[4], 'projectDocument.documentType'),
      url: asString(params[5], 'projectDocument.url'),
      status: asString(params[6], 'projectDocument.status'),
      uploadedBy: asString(params[7], 'projectDocument.uploadedBy'),
      uploadedAtIso: asString(params[8], 'projectDocument.uploadedAtIso'),
      archivedAtIso: asOptionalString(params[9]),
      archivedBy: asOptionalString(params[10]),
      updatedAtIso: asString(params[11], 'projectDocument.updatedAtIso'),
    } satisfies ProjectOpsDocumentRow);

    const key = documentKey(projectRequestId, row.id);
    if (this.projectDocuments.has(key)) {
      throw new Error(`Duplicate ProjectOps project document id: ${projectRequestId}/${row.id}`);
    }
    this.projectDocuments.set(key, row);
    return row;
  }

  private insertProjectNote(params: readonly unknown[]): ProjectOpsNoteRow | undefined {
    const projectRequestId = asString(params[1], 'projectNote.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (['cancelled', 'archived'].includes(parent.status)) return undefined;

    const row = Object.freeze({
      id: asString(params[0], 'projectNote.id'),
      projectRequestId,
      author: asString(params[2], 'projectNote.author'),
      visibility: asString(params[3], 'projectNote.visibility'),
      body: asString(params[4], 'projectNote.body'),
      status: asString(params[5], 'projectNote.status'),
      createdAtIso: asString(params[6], 'projectNote.createdAtIso'),
      archivedAtIso: asOptionalString(params[7]),
      archivedBy: asOptionalString(params[8]),
      updatedAtIso: asString(params[9], 'projectNote.updatedAtIso'),
    } satisfies ProjectOpsNoteRow);

    const key = noteKey(projectRequestId, row.id);
    if (this.projectNotes.has(key)) {
      throw new Error(`Duplicate ProjectOps project note id: ${projectRequestId}/${row.id}`);
    }
    this.projectNotes.set(key, row);
    return row;
  }

  private insertProjectTask(params: readonly unknown[]): ProjectOpsTaskRow | undefined {
    const projectRequestId = asString(params[1], 'projectTask.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (!['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(parent.status)) return undefined;

    const row = Object.freeze({
      id: asString(params[0], 'projectTask.id'),
      projectRequestId,
      title: asString(params[2], 'projectTask.title'),
      description: asOptionalString(params[3]),
      assignee: asOptionalString(params[4]),
      priority: asString(params[5], 'projectTask.priority'),
      status: asString(params[6], 'projectTask.status'),
      dueAtIso: asOptionalString(params[7]),
      createdAtIso: asString(params[8], 'projectTask.createdAtIso'),
      completedAtIso: asOptionalString(params[9]),
      completedBy: asOptionalString(params[10]),
      updatedAtIso: asString(params[11], 'projectTask.updatedAtIso'),
      revision: asNumber(params[12], 'projectTask.revision'),
    } satisfies ProjectOpsTaskRow);

    const key = taskKey(projectRequestId, row.id);
    if (this.projectTasks.has(key)) {
      throw new Error(`Duplicate ProjectOps project task id: ${projectRequestId}/${row.id}`);
    }
    this.projectTasks.set(key, row);
    return row;
  }

  private insertProjectWorkLog(params: readonly unknown[]): ProjectOpsWorkLogRow | undefined {
    const projectRequestId = asString(params[1], 'projectWorkLog.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent) {
      throw new Error(`ProjectOps project request not found: ${projectRequestId}`);
    }
    if (!['estimated', 'approved', 'in_progress', 'delivered'].includes(parent.status)) return undefined;

    const taskId = asOptionalString(params[2]);
    if (taskId && !this.projectTasks.has(taskKey(projectRequestId, taskId))) {
      throw new Error(`ProjectOps project task not found: ${projectRequestId}/${taskId}`);
    }

    const row = Object.freeze({
      id: asString(params[0], 'projectWorkLog.id'),
      projectRequestId,
      taskId,
      actor: asString(params[3], 'projectWorkLog.actor'),
      minutes: asNumber(params[4], 'projectWorkLog.minutes'),
      billable: asBoolean(params[5], 'projectWorkLog.billable'),
      note: asOptionalString(params[6]),
      loggedAtIso: asString(params[7], 'projectWorkLog.loggedAtIso'),
      createdAtIso: asString(params[8], 'projectWorkLog.createdAtIso'),
    } satisfies ProjectOpsWorkLogRow);

    const key = workLogKey(projectRequestId, row.id);
    if (this.projectWorkLogs.has(key)) {
      throw new Error(`Duplicate ProjectOps project work log id: ${projectRequestId}/${row.id}`);
    }
    this.projectWorkLogs.set(key, row);
    return row;
  }

  private insertProjectExpense(params: readonly unknown[]): ProjectOpsExpenseRow | undefined {
    const projectRequestId = asString(params[1], 'projectExpense.projectRequestId');
    const parent = this.projectRequests.get(projectRequestId);
    if (!parent || !(financeParentStates.submit as readonly string[]).includes(parent.status)) return undefined;

    const row = Object.freeze({
      id: asString(params[0], 'projectExpense.id'),
      projectRequestId,
      category: asString(params[2], 'projectExpense.category'),
      description: asString(params[3], 'projectExpense.description'),
      vendor: asOptionalString(params[4]),
      amountCents: asNumber(params[5], 'projectExpense.amountCents'),
      currency: asString(params[6], 'projectExpense.currency'),
      reimbursable: asBoolean(params[7], 'projectExpense.reimbursable'),
      receiptUrl: asOptionalString(params[8]),
      status: asString(params[9], 'projectExpense.status'),
      incurredAtIso: asString(params[10], 'projectExpense.incurredAtIso'),
      decidedAtIso: asOptionalString(params[11]),
      decidedBy: asOptionalString(params[12]),
      decisionNote: asOptionalString(params[13]),
      updatedAtIso: asString(params[14], 'projectExpense.updatedAtIso'),
    } satisfies ProjectOpsExpenseRow);

    const key = expenseKey(projectRequestId, row.id);
    if (this.projectExpenses.has(key)) {
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_EXPENSE_ALREADY_EXISTS', `Duplicate ProjectOps project expense id: ${projectRequestId}/${row.id}`);
    }
    this.projectExpenses.set(key, row);
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
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_ACTIVITY_ALREADY_EXISTS', `Duplicate ProjectOps project activity id: ${projectRequestId}/${row.id}`);
    }
    this.projectActivities.set(key, row);
    return row;
  }

  private estimateProjectRequest(params: readonly unknown[]): ProjectOpsRequestRow | undefined {
    const id = asString(params[0], 'projectRequest.id');
    const current = this.projectRequests.get(id);
    if (!current || (current.revision ?? 1) !== Number(params[6]) || current.status !== params[7]) return undefined;

    const next = Object.freeze({
      ...current,
      estimateAmountCents: asOptionalNumber(params[1]),
      estimateCurrency: asOptionalString(params[2]),
      estimatedAtIso: asOptionalString(params[3]),
      status: asString(params[4], 'projectRequest.status'),
      updatedAtIso: asString(params[5], 'projectRequest.updatedAtIso'),
      revision: (current.revision ?? 1) + 1,
    });
    this.projectRequests.set(id, next);
    return next;
  }

  private approveProjectRequest(params: readonly unknown[]): ProjectOpsRequestRow | undefined {
    const id = asString(params[0], 'projectRequest.id');
    const current = this.projectRequests.get(id);
    if (!current || current.status !== 'estimated' || (current.revision ?? 1) !== Number(params[5])) return undefined;

    const next = Object.freeze({
      ...current,
      approvedAtIso: asOptionalString(params[1]),
      approvedBy: asOptionalString(params[2]),
      status: asString(params[3], 'projectRequest.status'),
      updatedAtIso: asString(params[4], 'projectRequest.updatedAtIso'),
      revision: (current.revision ?? 1) + 1,
    });
    this.projectRequests.set(id, next);
    return next;
  }

  private updateProjectRequestStatus(params: readonly unknown[]): ProjectOpsRequestRow | undefined {
    const id = asString(params[0], 'projectRequest.id');
    const current = this.projectRequests.get(id);
    if (!current || (current.revision ?? 1) !== Number(params[3]) || current.status !== params[4]) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[1], 'projectRequest.status'),
      updatedAtIso: asString(params[2], 'projectRequest.updatedAtIso'),
      revision: (current.revision ?? 1) + 1,
    });
    this.projectRequests.set(id, next);
    return next;
  }

  private mutateProjectMilestone(
    params: readonly unknown[],
    sql: string
  ): ProjectOpsMilestoneRow | undefined {
    const projectRequestId = asString(params[0], 'projectMilestone.projectRequestId');
    const id = asString(params[1], 'projectMilestone.id');
    const parent = this.projectRequests.get(projectRequestId);
    const current = this.projectMilestones.get(milestoneKey(projectRequestId, id));
    const edit = sql.includes('SET TITLE =');
    const complete = sql.includes("SET STATUS = 'COMPLETED'");
    const expectedRevision = Number(params[edit ? 5 : 3]);
    const allowedStates = complete
      ? ['approved', 'in_progress', 'on_hold', 'delivered']
      : ['approved', 'in_progress'];
    const expectedStatus = complete || edit ? 'open' : 'completed';
    if (!parent || !allowedStates.includes(parent.status) || !current ||
      (current.revision ?? 1) !== expectedRevision || current.status !== expectedStatus) return undefined;

    const next = Object.freeze(edit ? {
      ...current,
      title: asString(params[2], 'projectMilestone.title'),
      dueAtIso: asOptionalString(params[3]),
      updatedAtIso: asString(params[4], 'projectMilestone.updatedAtIso'),
      revision: expectedRevision + 1,
    } : complete ? {
      ...current,
      status: 'completed',
      completedAtIso: asOptionalString(params[2]),
      updatedAtIso: asString(params[2], 'projectMilestone.updatedAtIso'),
      revision: expectedRevision + 1,
    } : {
      ...current,
      status: 'open',
      completedAtIso: undefined,
      updatedAtIso: asString(params[2], 'projectMilestone.updatedAtIso'),
      revision: expectedRevision + 1,
    });
    this.projectMilestones.set(milestoneKey(projectRequestId, id), next);
    return next;
  }

  private acceptProjectDeliverable(params: readonly unknown[]): ProjectOpsDeliverableRow | undefined {
    const projectRequestId = asString(params[0], 'projectDeliverable.projectRequestId');
    const id = asString(params[1], 'projectDeliverable.id');
    const current = this.projectDeliverables.get(deliverableKey(projectRequestId, id));
    if (!current || current.status !== 'submitted' || !['approved', 'in_progress', 'on_hold', 'delivered'].includes(this.projectRequests.get(projectRequestId)?.status ?? '')) return undefined;

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
    const parent = this.projectRequests.get(projectRequestId);
    if (!current || current.status !== 'issued' || !parent || !(financeParentStates.action as readonly string[]).includes(parent.status)) return undefined;

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
    const parent = this.projectRequests.get(projectRequestId);
    const current = this.projectIssues.get(issueKey(projectRequestId, id));
    if (!parent || ['cancelled', 'archived'].includes(parent.status) || !current || current.status !== 'open') return undefined;

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

  private mitigateProjectRisk(params: readonly unknown[]): ProjectOpsRiskRow | undefined {
    const projectRequestId = asString(params[0], 'projectRisk.projectRequestId');
    const id = asString(params[1], 'projectRisk.id');
    const parent = this.projectRequests.get(projectRequestId);
    const current = this.projectRisks.get(riskKey(projectRequestId, id));
    if (!parent || ['cancelled', 'archived'].includes(parent.status) || !current || current.status !== 'open') return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectRisk.status'),
      mitigatedAtIso: asOptionalString(params[3]),
      mitigationNote: asOptionalString(params[4]),
      updatedAtIso: asString(params[5], 'projectRisk.updatedAtIso'),
    });
    this.projectRisks.set(riskKey(projectRequestId, id), next);
    return next;
  }

  private addressProjectFeedback(params: readonly unknown[]): ProjectOpsFeedbackRow | undefined {
    const projectRequestId = asString(params[0], 'projectFeedback.projectRequestId');
    const id = asString(params[1], 'projectFeedback.id');
    const current = this.projectFeedback.get(feedbackKey(projectRequestId, id));
    if (!current || current.status !== 'open' || !['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(this.projectRequests.get(projectRequestId)?.status ?? '')) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectFeedback.status'),
      addressedAtIso: asOptionalString(params[3]),
      addressedBy: asOptionalString(params[4]),
      responseNote: asOptionalString(params[5]),
      updatedAtIso: asString(params[6], 'projectFeedback.updatedAtIso'),
    });
    this.projectFeedback.set(feedbackKey(projectRequestId, id), next);
    return next;
  }

  private archiveProjectDocument(params: readonly unknown[]): ProjectOpsDocumentRow | undefined {
    const projectRequestId = asString(params[0], 'projectDocument.projectRequestId');
    const id = asString(params[1], 'projectDocument.id');
    const parent = this.projectRequests.get(projectRequestId);
    const current = this.projectDocuments.get(documentKey(projectRequestId, id));
    if (!parent || ['cancelled', 'archived'].includes(parent.status) || !current || current.status !== 'active') return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectDocument.status'),
      archivedAtIso: asOptionalString(params[3]),
      archivedBy: asOptionalString(params[4]),
      updatedAtIso: asString(params[5], 'projectDocument.updatedAtIso'),
    });
    this.projectDocuments.set(documentKey(projectRequestId, id), next);
    return next;
  }

  private archiveProjectNote(params: readonly unknown[]): ProjectOpsNoteRow | undefined {
    const projectRequestId = asString(params[0], 'projectNote.projectRequestId');
    const id = asString(params[1], 'projectNote.id');
    const parent = this.projectRequests.get(projectRequestId);
    const current = this.projectNotes.get(noteKey(projectRequestId, id));
    if (!parent || ['cancelled', 'archived'].includes(parent.status) || !current || current.status !== 'active') return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectNote.status'),
      archivedAtIso: asOptionalString(params[3]),
      archivedBy: asOptionalString(params[4]),
      updatedAtIso: asString(params[5], 'projectNote.updatedAtIso'),
    });
    this.projectNotes.set(noteKey(projectRequestId, id), next);
    return next;
  }

  private mutateProjectTask(params: readonly unknown[], sql: string): ProjectOpsTaskRow | undefined {
    const projectRequestId = asString(params[0], 'projectTask.projectRequestId');
    const id = asString(params[1], 'projectTask.id');
    const parent = this.projectRequests.get(projectRequestId);
    const current = this.projectTasks.get(taskKey(projectRequestId, id));
    const edit = sql.includes('SET TITLE =');
    const complete = sql.includes("SET STATUS = 'COMPLETED'");
    const expectedRevision = Number(params[edit ? 8 : complete ? 4 : 3]);
    const expectedStatus = complete || edit ? 'open' : 'completed';
    if (!parent || !['estimated', 'approved', 'in_progress', 'on_hold', 'delivered'].includes(parent.status) ||
      !current || (current.revision ?? 1) !== expectedRevision || current.status !== expectedStatus) return undefined;

    const next = Object.freeze(edit ? {
      ...current,
      title: asString(params[2], 'projectTask.title'),
      description: asOptionalString(params[3]),
      assignee: asOptionalString(params[4]),
      priority: asString(params[5], 'projectTask.priority'),
      dueAtIso: asOptionalString(params[6]),
      updatedAtIso: asString(params[7], 'projectTask.updatedAtIso'),
      revision: expectedRevision + 1,
    } : complete ? {
      ...current,
      status: 'completed',
      completedAtIso: asOptionalString(params[2]),
      completedBy: asOptionalString(params[3]),
      updatedAtIso: asString(params[2], 'projectTask.updatedAtIso'),
      revision: expectedRevision + 1,
    } : {
      ...current,
      status: 'open',
      completedAtIso: undefined,
      completedBy: undefined,
      updatedAtIso: asString(params[2], 'projectTask.updatedAtIso'),
      revision: expectedRevision + 1,
    });
    this.projectTasks.set(taskKey(projectRequestId, id), next);
    return next;
  }

  private updateProjectExpenseDecision(params: readonly unknown[]): ProjectOpsExpenseRow | undefined {
    const projectRequestId = asString(params[0], 'projectExpense.projectRequestId');
    const id = asString(params[1], 'projectExpense.id');
    const current = this.projectExpenses.get(expenseKey(projectRequestId, id));
    const parent = this.projectRequests.get(projectRequestId);
    if (!current || current.status !== 'submitted' || !parent || !(financeParentStates.action as readonly string[]).includes(parent.status)) return undefined;

    const next = Object.freeze({
      ...current,
      status: asString(params[2], 'projectExpense.status'),
      decidedAtIso: asOptionalString(params[3]),
      decidedBy: asOptionalString(params[4]),
      decisionNote: asOptionalString(params[5]),
      updatedAtIso: asString(params[6], 'projectExpense.updatedAtIso'),
    });
    this.projectExpenses.set(expenseKey(projectRequestId, id), next);
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

  private selectProjectRisks(projectRequestId: string): readonly ProjectOpsRiskRow[] {
    return Object.freeze(
      [...this.projectRisks.values()]
        .filter((risk) => risk.projectRequestId === projectRequestId)
        .sort((a, b) => (
          b.identifiedAtIso.localeCompare(a.identifiedAtIso) ||
          b.updatedAtIso.localeCompare(a.updatedAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectRisk)
    );
  }

  private selectProjectFeedback(projectRequestId: string): readonly ProjectOpsFeedbackRow[] {
    return Object.freeze(
      [...this.projectFeedback.values()]
        .filter((feedback) => feedback.projectRequestId === projectRequestId)
        .sort((a, b) => b.receivedAtIso.localeCompare(a.receivedAtIso) || a.id.localeCompare(b.id))
        .map(toProjectFeedback)
    );
  }

  private selectProjectDocuments(projectRequestId: string): readonly ProjectOpsDocumentRow[] {
    return Object.freeze(
      [...this.projectDocuments.values()]
        .filter((document) => document.projectRequestId === projectRequestId)
        .sort((a, b) => b.uploadedAtIso.localeCompare(a.uploadedAtIso) || a.id.localeCompare(b.id))
        .map(toProjectDocument)
    );
  }

  private selectProjectNotes(projectRequestId: string): readonly ProjectOpsNoteRow[] {
    return Object.freeze(
      [...this.projectNotes.values()]
        .filter((note) => note.projectRequestId === projectRequestId)
        .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso) || a.id.localeCompare(b.id))
        .map(toProjectNote)
    );
  }

  private selectProjectTasks(projectRequestId: string): readonly ProjectOpsTaskRow[] {
    return Object.freeze(
      [...this.projectTasks.values()]
        .filter((task) => task.projectRequestId === projectRequestId)
        .sort((a, b) => (
          compareOptionalIso(a.dueAtIso, b.dueAtIso) ||
          b.createdAtIso.localeCompare(a.createdAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectTask)
    );
  }

  private selectProjectWorkLogs(projectRequestId: string): readonly ProjectOpsWorkLogRow[] {
    return Object.freeze(
      [...this.projectWorkLogs.values()]
        .filter((workLog) => workLog.projectRequestId === projectRequestId)
        .sort((a, b) => (
          b.loggedAtIso.localeCompare(a.loggedAtIso) ||
          b.createdAtIso.localeCompare(a.createdAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectWorkLog)
    );
  }

  private selectProjectExpenses(projectRequestId: string): readonly ProjectOpsExpenseRow[] {
    return Object.freeze(
      [...this.projectExpenses.values()]
        .filter((expense) => expense.projectRequestId === projectRequestId)
        .sort((a, b) => (
          b.incurredAtIso.localeCompare(a.incurredAtIso) ||
          b.updatedAtIso.localeCompare(a.updatedAtIso) ||
          a.id.localeCompare(b.id)
        ))
        .map(toProjectExpense)
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

  private selectDashboardRows(params: readonly unknown[]): readonly (ProjectOpsDashboardStorageRow | { id: null; hasEligibleProjects: boolean })[] {
    const status = String(params[0]), q = String(params[1]), now = Date.parse(String(params[2]));
    const hasEligibleProjects = [...this.projectRequests.values()].some(row => !['archived', 'cancelled'].includes(row.status));
    const attention = (rows: Iterable<{ id: string; projectRequestId: string; status: string; title: string; dueAtIso?: string }>, id: string, future: boolean) =>
      [...rows].filter(row => row.projectRequestId === id && row.status === 'open' && row.dueAtIso
        && (future ? Date.parse(row.dueAtIso) > now : Date.parse(row.dueAtIso) < now))
        .sort((a, b) => Date.parse(a.dueAtIso!) - Date.parse(b.dueAtIso!) || compareIdentity(a.id, b.id));
    const due = (row: { id: string; title: string; dueAtIso?: string } | undefined): DashboardDueItem | undefined =>
      row ? { id: row.id, title: row.title, dueAtIso: new Date(row.dueAtIso!).toISOString() } : undefined;
    const results =
      [...this.projectRequests.values()]
        .filter((request) => !['archived', 'cancelled'].includes(request.status))
        .filter(request => (status === 'all' || request.status === status)
          && (dashboardSearchText(request.title).includes(q) || dashboardSearchText(this.clients.get(request.clientId)!.name).includes(q)))
        .sort((a, b) => Date.parse(b.updatedAtIso) - Date.parse(a.updatedAtIso) || Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso) || compareIdentity(a.id, b.id))
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
            proposedChangeRequestCount: this.countChangeRequests(request.id, 'proposed'),
            approvedChangeRequestCount: this.countChangeRequests(request.id, 'approved'),
            rejectedChangeRequestCount: this.countChangeRequests(request.id, 'rejected'),
            openIssueCount: this.countIssues(request.id, 'open'),
            highOpenIssueCount: this.countHighOpenIssues(request.id),
            resolvedIssueCount: this.countIssues(request.id, 'resolved'),
            openRiskCount: this.countRisks(request.id, 'open'),
            highOpenRiskCount: this.countHighOpenRisks(request.id),
            mitigatedRiskCount: this.countRisks(request.id, 'mitigated'),
            openFeedbackCount: this.countFeedback(request.id, 'open'),
            addressedFeedbackCount: this.countFeedback(request.id, 'addressed'),
            negativeOpenFeedbackCount: this.countNegativeOpenFeedback(request.id),
            activeDocumentCount: this.countDocuments(request.id, 'active'),
            archivedDocumentCount: this.countDocuments(request.id, 'archived'),
            activeNoteCount: this.countNotes(request.id, 'active'),
            archivedNoteCount: this.countNotes(request.id, 'archived'),
            clientVisibleNoteCount: this.countClientVisibleNotes(request.id),
            openTaskCount: this.countTasks(request.id, 'open'),
            highOpenTaskCount: this.countHighOpenTasks(request.id),
            completedTaskCount: this.countTasks(request.id, 'completed'),
            nextTaskDueAtIso: this.nextOpenTaskDueAt(request.id),
            hasEligibleProjects, createdAtIso: request.createdAtIso,
            overdueTaskCount: attention(this.projectTasks.values(), request.id, false).length,
            overdueMilestoneCount: attention(this.projectMilestones.values(), request.id, false).length,
            nextOverdueTask: due(attention(this.projectTasks.values(), request.id, false)[0]),
            nextOverdueMilestone: due(attention(this.projectMilestones.values(), request.id, false)[0]),
            nextUpcomingTask: due(attention(this.projectTasks.values(), request.id, true)[0]),
            nextUpcomingMilestone: due(attention(this.projectMilestones.values(), request.id, true)[0]),
            workLogCount: this.countWorkLogs(request.id),
            billableWorkMinutes: this.sumWorkMinutes(request.id, true),
            nonBillableWorkMinutes: this.sumWorkMinutes(request.id, false),
            latestWorkLoggedAtIso: this.latestWorkLog(request.id)?.loggedAtIso,
            submittedExpenseCount: this.countExpenses(request.id, 'submitted'),
            approvedExpenseCount: this.countExpenses(request.id, 'approved'),
            rejectedExpenseCount: this.countExpenses(request.id, 'rejected'),
            financeTotalsByCurrency: totalProjectFinances(
              [...this.projectInvoices.values()].filter(row => row.projectRequestId === request.id),
              [...this.projectExpenses.values()].filter(row => row.projectRequestId === request.id)),
            latestActivityAtIso: this.latestActivity(request.id)?.happenedAtIso,
            latestActivitySummary: this.latestActivity(request.id)?.summary,
            updatedAtIso: request.updatedAtIso,
          });
        });
    return Object.freeze(results.length ? results : [{ id: null, hasEligibleProjects }]);
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

  private countRisks(projectRequestId: string, status: string): number {
    return [...this.projectRisks.values()].filter(
      (risk) => risk.projectRequestId === projectRequestId && risk.status === status
    ).length;
  }

  private countHighOpenRisks(projectRequestId: string): number {
    return [...this.projectRisks.values()].filter(
      (risk) => (
        risk.projectRequestId === projectRequestId &&
        risk.status === 'open' &&
        (risk.impact === 'high' || risk.probability === 'high')
      )
    ).length;
  }

  private countFeedback(projectRequestId: string, status: string): number {
    return [...this.projectFeedback.values()].filter(
      (feedback) => feedback.projectRequestId === projectRequestId && feedback.status === status
    ).length;
  }

  private countNegativeOpenFeedback(projectRequestId: string): number {
    return [...this.projectFeedback.values()].filter(
      (feedback) => (
        feedback.projectRequestId === projectRequestId &&
        feedback.status === 'open' &&
        feedback.sentiment === 'negative'
      )
    ).length;
  }

  private countDocuments(projectRequestId: string, status: string): number {
    return [...this.projectDocuments.values()].filter(
      (document) => document.projectRequestId === projectRequestId && document.status === status
    ).length;
  }

  private countNotes(projectRequestId: string, status: string): number {
    return [...this.projectNotes.values()].filter(
      (note) => note.projectRequestId === projectRequestId && note.status === status
    ).length;
  }

  private countClientVisibleNotes(projectRequestId: string): number {
    return [...this.projectNotes.values()].filter(
      (note) => note.projectRequestId === projectRequestId && note.status === 'active' && note.visibility === 'client'
    ).length;
  }

  private countTasks(projectRequestId: string, status: string): number {
    return [...this.projectTasks.values()].filter(
      (task) => task.projectRequestId === projectRequestId && task.status === status
    ).length;
  }

  private countHighOpenTasks(projectRequestId: string): number {
    return [...this.projectTasks.values()].filter(
      (task) => task.projectRequestId === projectRequestId && task.status === 'open' && task.priority === 'high'
    ).length;
  }

  private nextOpenTaskDueAt(projectRequestId: string): string | undefined {
    return [...this.projectTasks.values()]
      .filter((task) => task.projectRequestId === projectRequestId && task.status === 'open' && task.dueAtIso)
      .sort((a, b) => (
        Date.parse(a.dueAtIso!) - Date.parse(b.dueAtIso!) ||
        b.createdAtIso.localeCompare(a.createdAtIso) ||
        a.id.localeCompare(b.id)
      ))[0]?.dueAtIso;
  }

  private countWorkLogs(projectRequestId: string): number {
    return [...this.projectWorkLogs.values()].filter(
      (workLog) => workLog.projectRequestId === projectRequestId
    ).length;
  }

  private sumWorkMinutes(projectRequestId: string, billable: boolean): number {
    return [...this.projectWorkLogs.values()]
      .filter((workLog) => workLog.projectRequestId === projectRequestId && workLog.billable === billable)
      .reduce((total, workLog) => total + workLog.minutes, 0);
  }

  private latestWorkLog(projectRequestId: string): ProjectOpsWorkLogRow | undefined {
    return this.selectProjectWorkLogs(projectRequestId)[0];
  }

  private countExpenses(projectRequestId: string, status: string): number {
    return [...this.projectExpenses.values()].filter(
      (expense) => expense.projectRequestId === projectRequestId && expense.status === status
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

function toProjectRisk(row: ProjectOpsRiskRow): ProjectOpsRiskRow {
  return Object.freeze({ ...row });
}

function toProjectFeedback(row: ProjectOpsFeedbackRow): ProjectOpsFeedbackRow {
  return Object.freeze({ ...row });
}

function toProjectDocument(row: ProjectOpsDocumentRow): ProjectOpsDocumentRow {
  return Object.freeze({ ...row });
}

function toProjectNote(row: ProjectOpsNoteRow): ProjectOpsNoteRow {
  return Object.freeze({ ...row });
}

function toProjectTask(row: ProjectOpsTaskRow): ProjectOpsTaskRow {
  return Object.freeze({ ...row });
}

function toProjectWorkLog(row: ProjectOpsWorkLogRow): ProjectOpsWorkLogRow {
  return Object.freeze({ ...row });
}

function toProjectExpense(row: ProjectOpsExpenseRow): ProjectOpsExpenseRow {
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

function riskKey(projectRequestId: string, riskId: string): string {
  return `${projectRequestId}\0${riskId}`;
}

function feedbackKey(projectRequestId: string, feedbackId: string): string {
  return `${projectRequestId}\0${feedbackId}`;
}

function documentKey(projectRequestId: string, documentId: string): string {
  return `${projectRequestId}\0${documentId}`;
}

function noteKey(projectRequestId: string, noteId: string): string {
  return `${projectRequestId}\0${noteId}`;
}

function taskKey(projectRequestId: string, taskId: string): string {
  return `${projectRequestId}\0${taskId}`;
}

function workLogKey(projectRequestId: string, workLogId: string): string {
  return `${projectRequestId}\0${workLogId}`;
}

function expenseKey(projectRequestId: string, expenseId: string): string {
  return `${projectRequestId}\0${expenseId}`;
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
    ...(source.has_eligible_projects !== undefined ? { hasEligibleProjects: source.has_eligible_projects } : {}),
    ...(source.overdue_task_count !== undefined ? { overdueTaskCount: normalizeOptionalNumberValue(source.overdue_task_count) } : {}),
    ...(source.overdue_milestone_count !== undefined ? { overdueMilestoneCount: normalizeOptionalNumberValue(source.overdue_milestone_count) } : {}),
    ...Object.fromEntries(['next_overdue_task', 'next_overdue_milestone', 'next_upcoming_task', 'next_upcoming_milestone'].filter(key => source[key] !== undefined)
      .map(key => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), source[key] ? { ...(source[key] as DashboardDueItem), dueAtIso: new Date((source[key] as DashboardDueItem).dueAtIso).toISOString() } : undefined])),
    ...(source.finance_totals_by_currency !== undefined ? { financeTotalsByCurrency: source.finance_totals_by_currency } : {}),
    ...(source.client_id !== undefined ? { clientId: source.client_id } : {}),
    ...(source.client_name !== undefined ? { clientName: source.client_name } : {}),
    ...(source.budget_range !== undefined ? { budgetRange: normalizeOptionalValue(source.budget_range) } : {}),
    ...(source.project_request_id !== undefined ? { projectRequestId: source.project_request_id } : {}),
    ...(source.task_id !== undefined ? { taskId: normalizeOptionalValue(source.task_id) } : {}),
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
    ...(source.completed_by !== undefined ? { completedBy: normalizeOptionalValue(source.completed_by) } : {}),
    ...(source.artifact_url !== undefined ? { artifactUrl: source.artifact_url } : {}),
    ...(source.submitted_at !== undefined
      ? { submittedAtIso: normalizeIsoValue(source.submitted_at) }
      : {}),
    ...(source.accepted_at !== undefined
      ? { acceptedAtIso: normalizeOptionalIsoValue(source.accepted_at) }
      : {}),
    ...(source.invoice_number !== undefined ? { invoiceNumber: source.invoice_number } : {}),
    ...(source.amount_cents !== undefined ? { amountCents: normalizeOptionalNumberValue(source.amount_cents) } : {}),
    ...(source.receipt_url !== undefined ? { receiptUrl: normalizeOptionalValue(source.receipt_url) } : {}),
    ...(source.incurred_at !== undefined ? { incurredAtIso: normalizeIsoValue(source.incurred_at) } : {}),
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
    ...(source.mitigation_plan !== undefined ? { mitigationPlan: normalizeOptionalValue(source.mitigation_plan) } : {}),
    ...(source.identified_at !== undefined ? { identifiedAtIso: normalizeIsoValue(source.identified_at) } : {}),
    ...(source.mitigated_at !== undefined
      ? { mitigatedAtIso: normalizeOptionalIsoValue(source.mitigated_at) }
      : {}),
    ...(source.mitigation_note !== undefined ? { mitigationNote: normalizeOptionalValue(source.mitigation_note) } : {}),
    ...(source.received_at !== undefined ? { receivedAtIso: normalizeIsoValue(source.received_at) } : {}),
    ...(source.addressed_at !== undefined
      ? { addressedAtIso: normalizeOptionalIsoValue(source.addressed_at) }
      : {}),
    ...(source.addressed_by !== undefined ? { addressedBy: normalizeOptionalValue(source.addressed_by) } : {}),
    ...(source.response_note !== undefined ? { responseNote: normalizeOptionalValue(source.response_note) } : {}),
    ...(source.document_type !== undefined ? { documentType: source.document_type } : {}),
    ...(source.uploaded_by !== undefined ? { uploadedBy: source.uploaded_by } : {}),
    ...(source.uploaded_at !== undefined ? { uploadedAtIso: normalizeIsoValue(source.uploaded_at) } : {}),
    ...(source.archived_at !== undefined
      ? { archivedAtIso: normalizeOptionalIsoValue(source.archived_at) }
      : {}),
    ...(source.archived_by !== undefined ? { archivedBy: normalizeOptionalValue(source.archived_by) } : {}),
    ...(source.created_at !== undefined ? { createdAtIso: normalizeIsoValue(source.created_at) } : {}),
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
    ...(source.open_risk_count !== undefined
      ? { openRiskCount: normalizeOptionalNumberValue(source.open_risk_count) }
      : {}),
    ...(source.high_open_risk_count !== undefined
      ? { highOpenRiskCount: normalizeOptionalNumberValue(source.high_open_risk_count) }
      : {}),
    ...(source.mitigated_risk_count !== undefined
      ? { mitigatedRiskCount: normalizeOptionalNumberValue(source.mitigated_risk_count) }
      : {}),
    ...(source.open_feedback_count !== undefined
      ? { openFeedbackCount: normalizeOptionalNumberValue(source.open_feedback_count) }
      : {}),
    ...(source.addressed_feedback_count !== undefined
      ? { addressedFeedbackCount: normalizeOptionalNumberValue(source.addressed_feedback_count) }
      : {}),
    ...(source.negative_open_feedback_count !== undefined
      ? { negativeOpenFeedbackCount: normalizeOptionalNumberValue(source.negative_open_feedback_count) }
      : {}),
    ...(source.active_document_count !== undefined
      ? { activeDocumentCount: normalizeOptionalNumberValue(source.active_document_count) }
      : {}),
    ...(source.archived_document_count !== undefined
      ? { archivedDocumentCount: normalizeOptionalNumberValue(source.archived_document_count) }
      : {}),
    ...(source.active_note_count !== undefined
      ? { activeNoteCount: normalizeOptionalNumberValue(source.active_note_count) }
      : {}),
    ...(source.archived_note_count !== undefined
      ? { archivedNoteCount: normalizeOptionalNumberValue(source.archived_note_count) }
      : {}),
    ...(source.client_visible_note_count !== undefined
      ? { clientVisibleNoteCount: normalizeOptionalNumberValue(source.client_visible_note_count) }
      : {}),
    ...(source.open_task_count !== undefined
      ? { openTaskCount: normalizeOptionalNumberValue(source.open_task_count) }
      : {}),
    ...(source.high_open_task_count !== undefined
      ? { highOpenTaskCount: normalizeOptionalNumberValue(source.high_open_task_count) }
      : {}),
    ...(source.completed_task_count !== undefined
      ? { completedTaskCount: normalizeOptionalNumberValue(source.completed_task_count) }
      : {}),
    ...(source.next_task_due_at !== undefined
      ? { nextTaskDueAtIso: normalizeOptionalIsoValue(source.next_task_due_at) }
      : {}),
    ...(source.logged_at !== undefined ? { loggedAtIso: normalizeIsoValue(source.logged_at) } : {}),
    ...(source.work_log_count !== undefined
      ? { workLogCount: normalizeOptionalNumberValue(source.work_log_count) }
      : {}),
    ...(source.billable_work_minutes !== undefined
      ? { billableWorkMinutes: normalizeOptionalNumberValue(source.billable_work_minutes) }
      : {}),
    ...(source.non_billable_work_minutes !== undefined
      ? { nonBillableWorkMinutes: normalizeOptionalNumberValue(source.non_billable_work_minutes) }
      : {}),
    ...(source.latest_work_logged_at !== undefined
      ? { latestWorkLoggedAtIso: normalizeOptionalIsoValue(source.latest_work_logged_at) }
      : {}),
    ...(source.submitted_expense_count !== undefined
      ? { submittedExpenseCount: normalizeOptionalNumberValue(source.submitted_expense_count) }
      : {}),
    ...(source.approved_expense_count !== undefined
      ? { approvedExpenseCount: normalizeOptionalNumberValue(source.approved_expense_count) }
      : {}),
    ...(source.rejected_expense_count !== undefined
      ? { rejectedExpenseCount: normalizeOptionalNumberValue(source.rejected_expense_count) }
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

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Expected ${name} to be a boolean.`);
  }
  return value;
}

function mapProjectOpsStorageError(error: unknown, statement: SqlStatement): unknown {
  const code = (error as { code?: unknown })?.code;
  // A guarded child write mentions its parent too; classify constraints by the mutation target.
  statement = { ...statement, sql: statement.sql.match(/(?:INSERT INTO|UPDATE)\s+(projectops_\w+)/i)?.[1] ?? statement.sql };
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
  if (code === '23505' && statement.sql.includes('projectops_project_risks')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_RISK_ALREADY_EXISTS',
      'ProjectOps project risk already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_risks')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_feedback')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_FEEDBACK_ALREADY_EXISTS',
      'ProjectOps project feedback already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_feedback')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_FEEDBACK_RELATION_NOT_FOUND',
      'Project feedback relationship not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_documents')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_DOCUMENT_ALREADY_EXISTS',
      'ProjectOps project document already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_documents')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_DOCUMENT_RELATION_NOT_FOUND',
      'Project document relationship not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_notes')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_NOTE_ALREADY_EXISTS',
      'ProjectOps project note already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_notes')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_tasks')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_TASK_ALREADY_EXISTS',
      'ProjectOps project task already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_tasks')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_REQUEST_NOT_FOUND',
      'Project request not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_work_logs')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_WORK_LOG_ALREADY_EXISTS',
      'ProjectOps project work log already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_work_logs')) {
    return new ProjectOpsOperationError(
      'not_found',
      'PROJECTOPS_WORK_LOG_RELATION_NOT_FOUND',
      'Project work log relationship not found.'
    );
  }
  if (code === '23505' && statement.sql.includes('projectops_project_expenses')) {
    return new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_EXPENSE_ALREADY_EXISTS',
      'ProjectOps project expense already exists.'
    );
  }
  if (code === '23503' && statement.sql.includes('projectops_project_expenses')) {
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
  readonly revision?: number;
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly email?: string;
  readonly status: string;
  readonly createdAtIso: string;
}

interface ProjectOpsRequestRow {
  readonly revision?: number;
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
  readonly revision?: number;
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

interface ProjectOpsRiskRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description: string;
  readonly probability: string;
  readonly impact: string;
  readonly mitigationPlan?: string;
  readonly owner?: string;
  readonly status: string;
  readonly identifiedAtIso: string;
  readonly mitigatedAtIso?: string;
  readonly mitigationNote?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsFeedbackRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly author: string;
  readonly sentiment: string;
  readonly message: string;
  readonly status: string;
  readonly receivedAtIso: string;
  readonly addressedAtIso?: string;
  readonly addressedBy?: string;
  readonly responseNote?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsDocumentRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly deliverableId?: string;
  readonly title: string;
  readonly documentType: string;
  readonly url: string;
  readonly status: string;
  readonly uploadedBy: string;
  readonly uploadedAtIso: string;
  readonly archivedAtIso?: string;
  readonly archivedBy?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsNoteRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly author: string;
  readonly visibility: string;
  readonly body: string;
  readonly status: string;
  readonly createdAtIso: string;
  readonly archivedAtIso?: string;
  readonly archivedBy?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsTaskRow {
  readonly revision?: number;
  readonly id: string;
  readonly projectRequestId: string;
  readonly title: string;
  readonly description?: string;
  readonly assignee?: string;
  readonly priority: string;
  readonly status: string;
  readonly dueAtIso?: string;
  readonly createdAtIso: string;
  readonly completedAtIso?: string;
  readonly completedBy?: string;
  readonly updatedAtIso: string;
}

interface ProjectOpsWorkLogRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly taskId?: string;
  readonly actor: string;
  readonly minutes: number;
  readonly billable: boolean;
  readonly note?: string;
  readonly loggedAtIso: string;
  readonly createdAtIso: string;
}

interface ProjectOpsExpenseRow {
  readonly id: string;
  readonly projectRequestId: string;
  readonly category: string;
  readonly description: string;
  readonly vendor?: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly reimbursable: boolean;
  readonly receiptUrl?: string;
  readonly status: string;
  readonly incurredAtIso: string;
  readonly decidedAtIso?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
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
  readonly proposedChangeRequestCount?: number;
  readonly approvedChangeRequestCount?: number;
  readonly rejectedChangeRequestCount?: number;
  readonly openIssueCount?: number;
  readonly highOpenIssueCount?: number;
  readonly resolvedIssueCount?: number;
  readonly openRiskCount?: number;
  readonly highOpenRiskCount?: number;
  readonly mitigatedRiskCount?: number;
  readonly openFeedbackCount?: number;
  readonly addressedFeedbackCount?: number;
  readonly negativeOpenFeedbackCount?: number;
  readonly activeDocumentCount?: number;
  readonly archivedDocumentCount?: number;
  readonly activeNoteCount?: number;
  readonly archivedNoteCount?: number;
  readonly clientVisibleNoteCount?: number;
  readonly openTaskCount?: number;
  readonly highOpenTaskCount?: number;
  readonly completedTaskCount?: number;
  readonly nextTaskDueAtIso?: string;
  readonly workLogCount?: number;
  readonly billableWorkMinutes?: number;
  readonly nonBillableWorkMinutes?: number;
  readonly latestWorkLoggedAtIso?: string;
  readonly submittedExpenseCount?: number;
  readonly approvedExpenseCount?: number;
  readonly rejectedExpenseCount?: number;
  readonly latestActivityAtIso?: string;
  readonly latestActivitySummary?: string;
  readonly financeTotalsByCurrency?: ProjectFinanceTotalsByCurrency;
  readonly updatedAtIso: string;
}
