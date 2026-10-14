import { composeProjectExportSnapshot, validateExportIdentifier, type ProjectExportSnapshot } from './project-export.ts';
import { clientPageCursor, projectRequestPageCursor, toPage, validateClientPage, validateProjectRequestPage, type Page, type PageRequest } from './pagination.ts';
import { selectProjectExportSnapshotSql } from './sql.ts';
import { randomUUID } from 'node:crypto';
import { projectHistorySummary, type ProjectHistoryContext } from './history.ts';
import {
  ProjectOpsOperationError,
  requireFinanceParentState,
  validateFinanceIdentifier,
  acceptProjectDeliverable,
  addressProjectFeedback,
  archiveProjectDocument,
  archiveProjectNote,
  approveProjectExpense,
  approveProjectChangeRequest,
  approveProjectRequest,
  completeProjectTask,
  completeProjectMilestone,
  createProjectChangeRequest,
  createProjectActivity,
  createClient,
  editProject,
  type EditProjectInput,
  editClient,
  validateClientFilter,
  validateClientRevision,
  type EditClientInput,
  type ClientFilter,
  createProjectDeliverable,
  createProjectDocument,
  createProjectExpense,
  createProjectFeedback,
  createProjectInvoice,
  createProjectIssue,
  createProjectMilestone,
  createProjectNote,
  createProjectRequest,
  createProjectRisk,
  createProjectTask,
  createProjectWorkLog,
  editProjectMilestone,
  editProjectTask,
  estimateProjectRequest,
  markProjectInvoicePaid,
  mitigateProjectRisk,
  rejectProjectChangeRequest,
  rejectProjectExpense,
  reopenProjectMilestone,
  reopenProjectTask,
  requireExecutionActionParentState,
  requireDeliveryParentState,
  requireDeliveryReadiness,
  validateDeliveryIdentifier,
  requireMilestoneParentState,
  requirePlanningRevision,
  requireTaskParentState,
  resolveProjectIssue,
  transitionProjectRequest,
  type AddressProjectFeedbackInput,
  type ArchiveProjectDocumentInput,
  type ArchiveProjectNoteInput,
  type ApproveProjectRequestInput,
  type CompleteProjectTaskInput,
  type CompleteProjectMilestoneInput,
  type DecideProjectExpenseInput,
  type DecideProjectChangeRequestInput,
  type EstimateProjectRequestInput,
  type EditProjectMilestoneInput,
  type EditProjectTaskInput,
  type MitigateProjectRiskInput,
  type NewProjectActivityInput,
  type NewProjectChangeRequestInput,
  type NewProjectDeliverableInput,
  type NewProjectDocumentInput,
  type NewProjectExpenseInput,
  type NewProjectFeedbackInput,
  type NewProjectInvoiceInput,
  type NewProjectIssueInput,
  type NewProjectMilestoneInput,
  type NewProjectNoteInput,
  type NewProjectRiskInput,
  type NewClientInput,
  type NewProjectRequestInput,
  type NewProjectTaskInput,
  type NewProjectWorkLogInput,
  type ProjectActivity,
  type ProjectActivityEventType,
  type ProjectChangeRequest,
  type ProjectDeliverable,
  type ProjectDocument,
  type ProjectExecutionResource,
  type ProjectExpense,
  type ProjectFeedback,
  type ProjectInvoice,
  type ProjectIssue,
  type ProjectOpsClient,
  type ProjectMilestone,
  type ProjectNote,
  type ProjectRequest,
  type ProjectRequestStatus,
  type ProjectRisk,
  type ProjectTask,
  type ProjectWorkLog,
  type ResolveProjectIssueInput,
  type ReopenProjectMilestoneInput,
  type ReopenProjectTaskInput,
} from './domain.ts';
import {
  acceptProjectDeliverableSql,
  lockProjectRequestSql,
  addressProjectFeedbackSql,
  archiveProjectDocumentSql,
  archiveProjectNoteSql,
  approveProjectRequestSql,
  completeProjectTaskSql,
  completeProjectMilestoneSql,
  editProjectMilestoneSql,
  editProjectTaskSql,
  estimateProjectRequestSql,
  insertClientSql,
  editProjectSql,
  editClientSql,
  archiveClientSql,
  selectClientProjectsSql,
  insertProjectActivitySql,
  insertProjectChangeRequestSql,
  insertProjectDeliverableSql,
  insertProjectDocumentSql,
  insertProjectExpenseSql,
  insertProjectFeedbackSql,
  insertProjectInvoiceSql,
  insertProjectIssueSql,
  insertProjectMilestoneSql,
  insertProjectNoteSql,
  insertProjectRequestSql,
  insertProjectRiskSql,
  insertProjectTaskSql,
  insertProjectWorkLogSql,
  markProjectInvoicePaidSql,
  mitigateProjectRiskSql,
  selectClientByIdSql,
  selectClientsSql,
  selectDashboardRowsSql,
  selectProjectActivitiesSql,
  selectProjectActivityByIdSql,
  selectProjectChangeRequestByIdSql,
  selectProjectChangeRequestsSql,
  selectProjectDeliverableByIdSql,
  selectProjectDeliverablesSql,
  selectProjectDocumentByIdSql,
  selectProjectDocumentsSql,
  selectProjectExpenseByIdSql,
  selectProjectExpensesSql,
  selectProjectFeedbackByIdSql,
  selectProjectFeedbackSql,
  selectProjectInvoiceByIdSql,
  selectProjectInvoicesSql,
  selectProjectIssueByIdSql,
  selectProjectIssuesSql,
  selectProjectMilestoneByIdSql,
  selectProjectMilestonesSql,
  selectProjectNoteByIdSql,
  selectProjectNotesSql,
  selectProjectRequestByIdSql,
  selectProjectRequestsSql,
  selectProjectRiskByIdSql,
  selectProjectRisksSql,
  selectProjectTaskByIdSql,
  selectProjectTasksSql,
  selectProjectWorkLogByIdSql,
  selectProjectWorkLogsSql,
  resolveProjectIssueSql,
  reopenProjectMilestoneSql,
  reopenProjectTaskSql,
  updateProjectChangeRequestDecisionSql,
  updateProjectExpenseDecisionSql,
  updateProjectRequestStatusSql,
  type SqlStatement,
} from './sql.ts';
import {
  type DashboardFilter,
  composeProjectOpsDashboard,
  type ProjectOpsDashboardRow,
  type ProjectOpsDashboardView,
} from './dashboard.ts';

export interface ProjectOpsSqlExecutor {
  transaction?<T>(run: (sql: ProjectOpsSqlExecutor) => Promise<T>): Promise<T>;
  query<T>(statement: SqlStatement): Promise<readonly T[]>;
}

export class ProjectOpsRepository {
  private readonly sql: ProjectOpsSqlExecutor;
  private readonly history?: ProjectHistoryContext;

  constructor(sql: ProjectOpsSqlExecutor, history?: ProjectHistoryContext) {
    this.sql = sql;
    this.history = history;
  }

  /** A fresh repository avoids shared mutable operator identity between requests. */
  public withHistory(context: ProjectHistoryContext): ProjectOpsRepository {
    // The legacy activity model permits NULL actors; new automatic records must not inherit that option.
    if (typeof context.actor !== 'string' || !context.actor.trim() || context.actor.length > 120) {
      throw new Error('Automatic history requires a valid authenticated operator identity.');
    }
    return new ProjectOpsRepository(this.sql, Object.freeze({ ...context }));
  }

  private async recordCommand<T extends { readonly id: string; readonly status?: string }>(
    eventType: ProjectActivityEventType,
    projectRequestId: string,
    command: (repository: ProjectOpsRepository) => Promise<T>
  ): Promise<T> {
    if (!this.sql.transaction) throw new Error('Automatic history requires a transaction-scoped ProjectOps executor.');
    const context = this.history!;
    return await this.sql.transaction(async sql => {
      const scoped = new ProjectOpsRepository(sql);
      // Preserve the exact lifecycle source state, including start versus resume, under its lock.
      const previous = eventType === 'status_changed'
        ? (await sql.query<ProjectRequest>(lockProjectRequestSql(projectRequestId)))[0]
        : undefined;
      const result = await command(scoped);
      // Sample audit time after the winning guarded write, never from business dates or payload actors.
      const now = context.clock();
      const parent = await scoped.requireProjectRequest(projectRequestId);
      const activity = createProjectActivity(parent, {
        id: context.activityId?.() ?? randomUUID(), projectRequestId, eventType,
        summary: projectHistorySummary(eventType, result, previous?.status), actor: context.actor, happenedAtIso: now,
      });
      // Internal append intentionally permits the winning cancellation/archive's terminal parent.
      const rows = await sql.query<ProjectActivity>(insertProjectActivitySql(activity));
      if (!rows[0]) throw new Error('Required automatic history insert did not return a row.');
      return result;
    });
  }

  private async annotateProject(projectRequestId: string, summary: string): Promise<ProjectActivity> {
    if (!this.sql.transaction) throw new Error('Operator annotations require a transaction-scoped ProjectOps executor.');
    const context = this.history!;
    return await this.sql.transaction(async sql => {
      const parent = (await sql.query<ProjectRequest>(lockProjectRequestSql(projectRequestId)))[0];
      if (!parent) throw new ProjectOpsOperationError('not_found', 'PROJECTOPS_REQUEST_NOT_FOUND', 'Project not found.');
      if (['cancelled', 'archived'].includes(parent.status)) throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_PROJECT_READ_ONLY', 'Cancelled and archived projects are read-only.');
      const activity = createProjectActivity(parent, {
        id: context.activityId?.() ?? randomUUID(), projectRequestId, eventType: 'operator_annotation',
        summary, actor: context.actor, happenedAtIso: context.clock(),
      });
      const rows = await sql.query<ProjectActivity>(insertProjectActivitySql(activity));
      if (!rows[0]) throw new Error('Operator annotation insert did not return a row.');
      return rows[0];
    });
  }

  public async createClient(input: NewClientInput): Promise<ProjectOpsClient> {
    const client = createClient(input);
    const existing = await this.getClient(client.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_CLIENT_ALREADY_EXISTS',
        `ProjectOps client already exists: ${client.id}.`
      );
    }

    const rows = await this.sql.query<ProjectOpsClient>(insertClientSql(client));
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps client insert did not return a row.');
    }
    return persisted;
  }

  public async createProjectRequest(input: NewProjectRequestInput): Promise<ProjectRequest> {
    if (this.history) return await this.recordCommand('request_created', input.id, scoped => scoped.createProjectRequest(input));
    const request = createProjectRequest(input);
    const client = await this.getClient(request.clientId);
    if (!client) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_CLIENT_NOT_FOUND',
        `ProjectOps client not found: ${request.clientId}.`
      );
    }

    const existing = await this.getProjectRequest(request.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_REQUEST_ALREADY_EXISTS',
        `ProjectOps project request already exists: ${request.id}.`
      );
    }

    const rows = await this.sql.query<ProjectRequest>(insertProjectRequestSql(request));
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_CLIENT_ARCHIVED', 'Archived clients cannot receive new projects.');
    }
    return persisted;
  }

  public async listClients(filter: ClientFilter = {}, page: PageRequest = {}): Promise<Page<ProjectOpsClient>> {
    const validated = validateClientPage(page);
    const rows = await this.sql.query<ProjectOpsClient>(selectClientsSql(validateClientFilter(filter), validated));
    return toPage(rows, validated.limit, clientPageCursor);
  }

  public async editClient(id: string, input: EditClientInput): Promise<ProjectOpsClient> {
    const client = await this.requireClient(id);
    const prepared = editClient(client, input);
    const rows = await this.sql.query<ProjectOpsClient>(editClientSql(prepared, input.expectedRevision));
    if (!rows[0]) throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_CLIENT_CHANGED', 'Client changed or is archived. Reload before trying again.');
    return rows[0];
  }
  public async archiveClient(id: string, expectedRevision: number): Promise<ProjectOpsClient> {
    validateClientRevision(expectedRevision);
    await this.requireClient(id);
    const rows = await this.sql.query<ProjectOpsClient>(archiveClientSql(id, expectedRevision));
    if (!rows[0]) throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_CLIENT_CHANGED', 'Client changed or is archived. Reload before trying again.');
    return rows[0];
  }
  public async listClientProjects(id: string): Promise<readonly ProjectRequest[]> {
    await this.requireClient(id);
    return await this.sql.query<ProjectRequest>(selectClientProjectsSql(id));
  }
  private async requireClient(id: string): Promise<ProjectOpsClient> {
    const client = await this.getClient(id);
    if (!client) throw new ProjectOpsOperationError('not_found', 'PROJECTOPS_CLIENT_NOT_FOUND', 'Client not found.');
    return client;
  }

  public async getClient(id: string): Promise<ProjectOpsClient | undefined> {
    const rows = await this.sql.query<ProjectOpsClient>(selectClientByIdSql(id));
    return rows[0];
  }

  public async listProjectRequests(page: PageRequest = {}): Promise<Page<ProjectRequest>> {
    const validated = validateProjectRequestPage(page);
    const rows = await this.sql.query<ProjectRequest>(selectProjectRequestsSql(validated));
    return toPage(rows, validated.limit, projectRequestPageCursor);
  }

  public async getProjectRequest(id: string): Promise<ProjectRequest | undefined> {
    const rows = await this.sql.query<ProjectRequest>(selectProjectRequestByIdSql(id));
    return rows[0];
  }

  public async editProject(id: string, input: EditProjectInput, nowIso: string): Promise<ProjectRequest> {
    if (this.history) return await this.recordCommand('request_edited', id, scoped => scoped.editProject(id, input, nowIso));
    const request = await this.getProjectRequest(id);
    if (!request) throw new ProjectOpsOperationError('not_found', 'PROJECTOPS_REQUEST_NOT_FOUND', 'Project not found.');
    const prepared = editProject(request, input, nowIso);
    const rows = await this.sql.query<ProjectRequest>(editProjectSql(prepared, input.expectedRevision));
    if (!rows[0]) throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_PROJECT_CHANGED', 'Project changed or is cancelled/archived. Reload before trying again.');
    return rows[0];
  }

  public async createProjectMilestone(
    projectRequestId: string,
    input: NewProjectMilestoneInput
  ): Promise<ProjectMilestone> {
    if (this.history) return await this.recordCommand('milestone_created', projectRequestId, scoped => scoped.createProjectMilestone(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const milestone = createProjectMilestone(request, input);
    const existing = await this.getProjectMilestone(projectRequestId, milestone.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_MILESTONE_ALREADY_EXISTS',
        `ProjectOps project milestone already exists: ${milestone.id}.`
      );
    }

    const rows = await this.sql.query<ProjectMilestone>(insertProjectMilestoneSql(milestone));
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_MILESTONE_CHANGED',
        'Project state changed before the milestone could be created. Reload before trying again.'
      );
    }
    return persisted;
  }

  public async listProjectMilestones(
    projectRequestId: string
  ): Promise<readonly ProjectMilestone[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectMilestone>(selectProjectMilestonesSql(projectRequestId));
  }

  public async getProjectMilestone(
    projectRequestId: string,
    milestoneId: string
  ): Promise<ProjectMilestone | undefined> {
    const rows = await this.sql.query<ProjectMilestone>(
      selectProjectMilestoneByIdSql(projectRequestId, milestoneId)
    );
    return rows[0];
  }

  public async completeProjectMilestone(
    projectRequestId: string,
    milestoneId: string,
    input: string | CompleteProjectMilestoneInput
  ): Promise<ProjectMilestone> {
    if (this.history) return await this.recordCommand('milestone_completed', projectRequestId, scoped => scoped.completeProjectMilestone(projectRequestId, milestoneId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectMilestone(projectRequestId, milestoneId);
    const normalized = typeof input === 'string' ? { completedAtIso: input } : input;
    const revision = this.planningRevision(current.revision, normalized.expectedRevision, 'milestone');
    requireMilestoneParentState(request, 'complete');
    const completed = completeProjectMilestone(current, normalized.completedAtIso);
    const rows = await this.sql.query<ProjectMilestone>(completeProjectMilestoneSql(completed, revision));
    return this.requirePlanningWrite(rows, 'milestone');
  }

  public async editProjectMilestone(
    projectRequestId: string,
    milestoneId: string,
    input: EditProjectMilestoneInput,
    nowIso: string
  ): Promise<ProjectMilestone> {
    if (this.history) return await this.recordCommand('milestone_edited', projectRequestId, scoped => scoped.editProjectMilestone(projectRequestId, milestoneId, input, nowIso));
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectMilestone(projectRequestId, milestoneId);
    const revision = this.planningRevision(current.revision, input.expectedRevision, 'milestone');
    const edited = editProjectMilestone(request, current, input, nowIso);
    const rows = await this.sql.query<ProjectMilestone>(editProjectMilestoneSql(edited, revision));
    return this.requirePlanningWrite(rows, 'milestone');
  }

  public async reopenProjectMilestone(
    projectRequestId: string,
    milestoneId: string,
    input: ReopenProjectMilestoneInput
  ): Promise<ProjectMilestone> {
    if (this.history) return await this.recordCommand('milestone_reopened', projectRequestId, scoped => scoped.reopenProjectMilestone(projectRequestId, milestoneId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectMilestone(projectRequestId, milestoneId);
    const revision = this.planningRevision(current.revision, input.expectedRevision, 'milestone');
    const reopened = reopenProjectMilestone(request, current, input);
    const rows = await this.sql.query<ProjectMilestone>(reopenProjectMilestoneSql(reopened, revision));
    return this.requirePlanningWrite(rows, 'milestone');
  }

  public async createProjectDeliverable(
    projectRequestId: string,
    input: NewProjectDeliverableInput
  ): Promise<ProjectDeliverable> {
    if (this.history) return await this.recordCommand('deliverable_submitted', projectRequestId, scoped => scoped.createProjectDeliverable(projectRequestId, input));
    validateDeliveryIdentifier(projectRequestId);
    const request = await this.requireProjectRequest(projectRequestId);
    const deliverable = createProjectDeliverable(request, input);
    if (deliverable.milestoneId) {
      await this.requireProjectMilestone(projectRequestId, deliverable.milestoneId);
    }

    const existing = await this.getProjectDeliverable(projectRequestId, deliverable.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_DELIVERABLE_ALREADY_EXISTS',
        `ProjectOps project deliverable already exists: ${deliverable.id}.`
      );
    }

    const rows = await this.sql.query<ProjectDeliverable>(insertProjectDeliverableSql(deliverable));
    return await this.requireDeliveryWrite(rows, projectRequestId);
  }

  public async listProjectDeliverables(
    projectRequestId: string
  ): Promise<readonly ProjectDeliverable[]> {
    validateDeliveryIdentifier(projectRequestId);
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectDeliverable>(selectProjectDeliverablesSql(projectRequestId));
  }

  public async getProjectDeliverable(
    projectRequestId: string,
    deliverableId: string
  ): Promise<ProjectDeliverable | undefined> {
    const rows = await this.sql.query<ProjectDeliverable>(
      selectProjectDeliverableByIdSql(projectRequestId, deliverableId)
    );
    return rows[0];
  }

  public async acceptProjectDeliverable(
    projectRequestId: string,
    deliverableId: string,
    acceptedAtIso: string
  ): Promise<ProjectDeliverable> {
    if (this.history) return await this.recordCommand('deliverable_accepted', projectRequestId, scoped => scoped.acceptProjectDeliverable(projectRequestId, deliverableId, acceptedAtIso));
    validateDeliveryIdentifier(projectRequestId);
    validateDeliveryIdentifier(deliverableId);
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectDeliverable(projectRequestId, deliverableId);
    requireDeliveryParentState(request, 'accept');
    const accepted = acceptProjectDeliverable(current, acceptedAtIso);
    const rows = await this.sql.query<ProjectDeliverable>(acceptProjectDeliverableSql(accepted));
    return await this.requireDeliveryWrite(rows, projectRequestId, 'deliverable', deliverableId);
  }

  public async createProjectInvoice(
    projectRequestId: string,
    input: NewProjectInvoiceInput
  ): Promise<ProjectInvoice> {
    if (this.history) return await this.recordCommand('invoice_issued', projectRequestId, scoped => scoped.createProjectInvoice(projectRequestId, input));
    validateFinanceIdentifier(projectRequestId);
    if (!this.sql.transaction) throw new Error('Invoice issuance requires a transaction-scoped ProjectOps executor.');
    return await this.sql.transaction(async sql => {
      const scoped = new ProjectOpsRepository(sql);
      const rows = await sql.query<ProjectRequest>(lockProjectRequestSql(projectRequestId));
      const request = rows[0];
      if (!request) throw new ProjectOpsOperationError('not_found', 'PROJECTOPS_REQUEST_NOT_FOUND', `Project request not found: ${projectRequestId}.`);
      const invoice = createProjectInvoice(request, input);
      // Read the relationship after the parent lock, with a fresh READ COMMITTED snapshot.
      if (invoice.deliverableId) {
        const deliverable = await scoped.requireProjectDeliverable(projectRequestId, invoice.deliverableId);
        if (deliverable.status !== 'accepted') throw new ProjectOpsOperationError('conflict',
          'PROJECTOPS_DELIVERABLE_NOT_ACCEPTED', 'Project deliverable must be accepted before issuing an attached invoice.');
      }
      return scoped.requireFinanceWrite(await sql.query<ProjectInvoice>(insertProjectInvoiceSql(invoice)), projectRequestId);
    });
  }

  public async listProjectInvoices(
    projectRequestId: string
  ): Promise<readonly ProjectInvoice[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectInvoice>(selectProjectInvoicesSql(projectRequestId));
  }

  public async getProjectInvoice(
    projectRequestId: string,
    invoiceId: string
  ): Promise<ProjectInvoice | undefined> {
    const rows = await this.sql.query<ProjectInvoice>(
      selectProjectInvoiceByIdSql(projectRequestId, invoiceId)
    );
    return rows[0];
  }

  public async markProjectInvoicePaid(
    projectRequestId: string,
    invoiceId: string,
    paidAtIso: string
  ): Promise<ProjectInvoice> {
    if (this.history) return await this.recordCommand('invoice_paid', projectRequestId, scoped => scoped.markProjectInvoicePaid(projectRequestId, invoiceId, paidAtIso));
    validateFinanceIdentifier(projectRequestId); validateFinanceIdentifier(invoiceId);
    const parent = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectInvoice(projectRequestId, invoiceId);
    requireFinanceParentState(parent, 'action');
    const paid = markProjectInvoicePaid(current, paidAtIso);
    return this.requireFinanceWrite(await this.sql.query<ProjectInvoice>(markProjectInvoicePaidSql(paid)), projectRequestId, 'invoice', invoiceId);
  }

  public async createProjectChangeRequest(
    projectRequestId: string,
    input: NewProjectChangeRequestInput
  ): Promise<ProjectChangeRequest> {
    const request = await this.requireProjectRequest(projectRequestId);
    const changeRequest = createProjectChangeRequest(request, input);
    const existing = await this.getProjectChangeRequest(projectRequestId, changeRequest.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_CHANGE_REQUEST_ALREADY_EXISTS',
        `ProjectOps project change request already exists: ${changeRequest.id}.`
      );
    }

    const rows = await this.sql.query<ProjectChangeRequest>(
      insertProjectChangeRequestSql(changeRequest)
    );
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project change request insert did not return a row.');
    }
    return persisted;
  }

  public async listProjectChangeRequests(
    projectRequestId: string
  ): Promise<readonly ProjectChangeRequest[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectChangeRequest>(selectProjectChangeRequestsSql(projectRequestId));
  }

  public async getProjectChangeRequest(
    projectRequestId: string,
    changeRequestId: string
  ): Promise<ProjectChangeRequest | undefined> {
    const rows = await this.sql.query<ProjectChangeRequest>(
      selectProjectChangeRequestByIdSql(projectRequestId, changeRequestId)
    );
    return rows[0];
  }

  public async approveProjectChangeRequest(
    projectRequestId: string,
    changeRequestId: string,
    input: DecideProjectChangeRequestInput
  ): Promise<ProjectChangeRequest> {
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectChangeRequest(projectRequestId, changeRequestId);
    const approved = approveProjectChangeRequest(current, input);
    const rows = await this.sql.query<ProjectChangeRequest>(
      updateProjectChangeRequestDecisionSql(approved)
    );
    return this.requirePersistedProjectChangeRequest(rows, projectRequestId, changeRequestId);
  }

  public async rejectProjectChangeRequest(
    projectRequestId: string,
    changeRequestId: string,
    input: DecideProjectChangeRequestInput
  ): Promise<ProjectChangeRequest> {
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectChangeRequest(projectRequestId, changeRequestId);
    const rejected = rejectProjectChangeRequest(current, input);
    const rows = await this.sql.query<ProjectChangeRequest>(
      updateProjectChangeRequestDecisionSql(rejected)
    );
    return this.requirePersistedProjectChangeRequest(rows, projectRequestId, changeRequestId);
  }

  public async createProjectIssue(
    projectRequestId: string,
    input: NewProjectIssueInput
  ): Promise<ProjectIssue> {
    if (this.history) return await this.recordCommand('issue_created', projectRequestId, scoped => scoped.createProjectIssue(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const issue = createProjectIssue(request, input);
    const existing = await this.getProjectIssue(projectRequestId, issue.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_ISSUE_ALREADY_EXISTS',
        `ProjectOps project issue already exists: ${issue.id}.`
      );
    }

    const rows = await this.sql.query<ProjectIssue>(insertProjectIssueSql(issue));
    return await this.requireExecutionCreateWrite(rows, projectRequestId, 'issue');
  }

  public async listProjectIssues(projectRequestId: string): Promise<readonly ProjectIssue[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectIssue>(selectProjectIssuesSql(projectRequestId));
  }

  public async getProjectIssue(
    projectRequestId: string,
    issueId: string
  ): Promise<ProjectIssue | undefined> {
    const rows = await this.sql.query<ProjectIssue>(
      selectProjectIssueByIdSql(projectRequestId, issueId)
    );
    return rows[0];
  }

  public async resolveProjectIssue(
    projectRequestId: string,
    issueId: string,
    input: ResolveProjectIssueInput
  ): Promise<ProjectIssue> {
    if (this.history) return await this.recordCommand('issue_resolved', projectRequestId, scoped => scoped.resolveProjectIssue(projectRequestId, issueId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    requireExecutionActionParentState(request);
    const current = await this.requireProjectIssue(projectRequestId, issueId);
    const resolved = resolveProjectIssue(current, input);
    const rows = await this.sql.query<ProjectIssue>(resolveProjectIssueSql(resolved));
    return await this.requireExecutionActionWrite(rows, projectRequestId, issueId, 'issue');
  }

  public async createProjectRisk(
    projectRequestId: string,
    input: NewProjectRiskInput
  ): Promise<ProjectRisk> {
    if (this.history) return await this.recordCommand('risk_created', projectRequestId, scoped => scoped.createProjectRisk(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const risk = createProjectRisk(request, input);
    const existing = await this.getProjectRisk(projectRequestId, risk.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_RISK_ALREADY_EXISTS',
        `ProjectOps project risk already exists: ${risk.id}.`
      );
    }

    const rows = await this.sql.query<ProjectRisk>(insertProjectRiskSql(risk));
    return await this.requireExecutionCreateWrite(rows, projectRequestId, 'risk');
  }

  public async listProjectRisks(projectRequestId: string): Promise<readonly ProjectRisk[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectRisk>(selectProjectRisksSql(projectRequestId));
  }

  public async getProjectRisk(
    projectRequestId: string,
    riskId: string
  ): Promise<ProjectRisk | undefined> {
    const rows = await this.sql.query<ProjectRisk>(
      selectProjectRiskByIdSql(projectRequestId, riskId)
    );
    return rows[0];
  }

  public async mitigateProjectRisk(
    projectRequestId: string,
    riskId: string,
    input: MitigateProjectRiskInput
  ): Promise<ProjectRisk> {
    if (this.history) return await this.recordCommand('risk_mitigated', projectRequestId, scoped => scoped.mitigateProjectRisk(projectRequestId, riskId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    requireExecutionActionParentState(request);
    const current = await this.requireProjectRisk(projectRequestId, riskId);
    const mitigated = mitigateProjectRisk(current, input);
    const rows = await this.sql.query<ProjectRisk>(mitigateProjectRiskSql(mitigated));
    return await this.requireExecutionActionWrite(rows, projectRequestId, riskId, 'risk');
  }

  public async createProjectFeedback(
    projectRequestId: string,
    input: NewProjectFeedbackInput
  ): Promise<ProjectFeedback> {
    if (this.history) return await this.recordCommand('feedback_added', projectRequestId, scoped => scoped.createProjectFeedback(projectRequestId, input));
    validateDeliveryIdentifier(projectRequestId);
    const request = await this.requireProjectRequest(projectRequestId);
    const feedback = createProjectFeedback(request, input);
    if (feedback.deliverableId) {
      await this.requireProjectDeliverable(projectRequestId, feedback.deliverableId);
    }

    const existing = await this.getProjectFeedback(projectRequestId, feedback.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_FEEDBACK_ALREADY_EXISTS',
        `ProjectOps project feedback already exists: ${feedback.id}.`
      );
    }

    const rows = await this.sql.query<ProjectFeedback>(insertProjectFeedbackSql(feedback));
    return await this.requireDeliveryWrite(rows, projectRequestId);
  }

  public async listProjectFeedback(
    projectRequestId: string
  ): Promise<readonly ProjectFeedback[]> {
    validateDeliveryIdentifier(projectRequestId);
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectFeedback>(selectProjectFeedbackSql(projectRequestId));
  }

  public async getProjectFeedback(
    projectRequestId: string,
    feedbackId: string
  ): Promise<ProjectFeedback | undefined> {
    const rows = await this.sql.query<ProjectFeedback>(
      selectProjectFeedbackByIdSql(projectRequestId, feedbackId)
    );
    return rows[0];
  }

  public async addressProjectFeedback(
    projectRequestId: string,
    feedbackId: string,
    input: AddressProjectFeedbackInput
  ): Promise<ProjectFeedback> {
    if (this.history) return await this.recordCommand('feedback_addressed', projectRequestId, scoped => scoped.addressProjectFeedback(projectRequestId, feedbackId, input));
    validateDeliveryIdentifier(projectRequestId);
    validateDeliveryIdentifier(feedbackId);
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectFeedback(projectRequestId, feedbackId);
    requireDeliveryParentState(request, 'feedback');
    const addressed = addressProjectFeedback(current, input);
    const rows = await this.sql.query<ProjectFeedback>(addressProjectFeedbackSql(addressed));
    return await this.requireDeliveryWrite(rows, projectRequestId, 'feedback', feedbackId);
  }

  public async createProjectDocument(
    projectRequestId: string,
    input: NewProjectDocumentInput
  ): Promise<ProjectDocument> {
    if (this.history) return await this.recordCommand('document_added', projectRequestId, scoped => scoped.createProjectDocument(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const document = createProjectDocument(request, input);
    if (document.deliverableId) {
      await this.requireProjectDeliverable(projectRequestId, document.deliverableId);
    }

    const existing = await this.getProjectDocument(projectRequestId, document.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_DOCUMENT_ALREADY_EXISTS',
        `ProjectOps project document already exists: ${document.id}.`
      );
    }

    const rows = await this.sql.query<ProjectDocument>(insertProjectDocumentSql(document));
    return await this.requireExecutionCreateWrite(rows, projectRequestId, 'document');
  }

  public async listProjectDocuments(
    projectRequestId: string
  ): Promise<readonly ProjectDocument[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectDocument>(selectProjectDocumentsSql(projectRequestId));
  }

  public async getProjectDocument(
    projectRequestId: string,
    documentId: string
  ): Promise<ProjectDocument | undefined> {
    const rows = await this.sql.query<ProjectDocument>(
      selectProjectDocumentByIdSql(projectRequestId, documentId)
    );
    return rows[0];
  }

  public async archiveProjectDocument(
    projectRequestId: string,
    documentId: string,
    input: ArchiveProjectDocumentInput
  ): Promise<ProjectDocument> {
    if (this.history) return await this.recordCommand('document_archived', projectRequestId, scoped => scoped.archiveProjectDocument(projectRequestId, documentId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    requireExecutionActionParentState(request);
    const current = await this.requireProjectDocument(projectRequestId, documentId);
    const archived = archiveProjectDocument(current, input);
    const rows = await this.sql.query<ProjectDocument>(archiveProjectDocumentSql(archived));
    return await this.requireExecutionActionWrite(rows, projectRequestId, documentId, 'document');
  }

  public async createProjectNote(
    projectRequestId: string,
    input: NewProjectNoteInput
  ): Promise<ProjectNote> {
    if (this.history) return await this.recordCommand('note_added', projectRequestId, scoped => scoped.createProjectNote(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const note = createProjectNote(request, input);
    const existing = await this.getProjectNote(projectRequestId, note.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_NOTE_ALREADY_EXISTS',
        `ProjectOps project note already exists: ${note.id}.`
      );
    }

    const rows = await this.sql.query<ProjectNote>(insertProjectNoteSql(note));
    return await this.requireExecutionCreateWrite(rows, projectRequestId, 'note');
  }

  public async listProjectNotes(projectRequestId: string): Promise<readonly ProjectNote[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectNote>(selectProjectNotesSql(projectRequestId));
  }

  public async getProjectNote(
    projectRequestId: string,
    noteId: string
  ): Promise<ProjectNote | undefined> {
    const rows = await this.sql.query<ProjectNote>(
      selectProjectNoteByIdSql(projectRequestId, noteId)
    );
    return rows[0];
  }

  public async archiveProjectNote(
    projectRequestId: string,
    noteId: string,
    input: ArchiveProjectNoteInput
  ): Promise<ProjectNote> {
    if (this.history) return await this.recordCommand('note_archived', projectRequestId, scoped => scoped.archiveProjectNote(projectRequestId, noteId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    requireExecutionActionParentState(request);
    const current = await this.requireProjectNote(projectRequestId, noteId);
    const archived = archiveProjectNote(current, input);
    const rows = await this.sql.query<ProjectNote>(archiveProjectNoteSql(archived));
    return await this.requireExecutionActionWrite(rows, projectRequestId, noteId, 'note');
  }

  public async createProjectTask(
    projectRequestId: string,
    input: NewProjectTaskInput
  ): Promise<ProjectTask> {
    if (this.history) return await this.recordCommand('task_created', projectRequestId, scoped => scoped.createProjectTask(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const task = createProjectTask(request, input);
    const existing = await this.getProjectTask(projectRequestId, task.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_TASK_ALREADY_EXISTS',
        `ProjectOps project task already exists: ${task.id}.`
      );
    }

    const rows = await this.sql.query<ProjectTask>(insertProjectTaskSql(task));
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_TASK_CHANGED',
        'Project state changed before the task could be created. Reload before trying again.'
      );
    }
    return persisted;
  }

  public async listProjectTasks(projectRequestId: string): Promise<readonly ProjectTask[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectTask>(selectProjectTasksSql(projectRequestId));
  }

  public async getProjectTask(
    projectRequestId: string,
    taskId: string
  ): Promise<ProjectTask | undefined> {
    const rows = await this.sql.query<ProjectTask>(
      selectProjectTaskByIdSql(projectRequestId, taskId)
    );
    return rows[0];
  }

  public async completeProjectTask(
    projectRequestId: string,
    taskId: string,
    input: CompleteProjectTaskInput
  ): Promise<ProjectTask> {
    if (this.history) return await this.recordCommand('task_completed', projectRequestId, scoped => scoped.completeProjectTask(projectRequestId, taskId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectTask(projectRequestId, taskId);
    const revision = this.planningRevision(current.revision, input.expectedRevision, 'task');
    requireTaskParentState(request, 'complete');
    const completed = completeProjectTask(current, input);
    const rows = await this.sql.query<ProjectTask>(completeProjectTaskSql(completed, revision));
    return this.requirePlanningWrite(rows, 'task');
  }

  public async editProjectTask(
    projectRequestId: string,
    taskId: string,
    input: EditProjectTaskInput,
    nowIso: string
  ): Promise<ProjectTask> {
    if (this.history) return await this.recordCommand('task_edited', projectRequestId, scoped => scoped.editProjectTask(projectRequestId, taskId, input, nowIso));
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectTask(projectRequestId, taskId);
    const revision = this.planningRevision(current.revision, input.expectedRevision, 'task');
    const edited = editProjectTask(request, current, input, nowIso);
    const rows = await this.sql.query<ProjectTask>(editProjectTaskSql(edited, revision));
    return this.requirePlanningWrite(rows, 'task');
  }

  public async reopenProjectTask(
    projectRequestId: string,
    taskId: string,
    input: ReopenProjectTaskInput
  ): Promise<ProjectTask> {
    if (this.history) return await this.recordCommand('task_reopened', projectRequestId, scoped => scoped.reopenProjectTask(projectRequestId, taskId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectTask(projectRequestId, taskId);
    const revision = this.planningRevision(current.revision, input.expectedRevision, 'task');
    const reopened = reopenProjectTask(request, current, input);
    const rows = await this.sql.query<ProjectTask>(reopenProjectTaskSql(reopened, revision));
    return this.requirePlanningWrite(rows, 'task');
  }

  public async createProjectWorkLog(
    projectRequestId: string,
    input: NewProjectWorkLogInput
  ): Promise<ProjectWorkLog> {
    if (this.history) return await this.recordCommand('work_log_added', projectRequestId, scoped => scoped.createProjectWorkLog(projectRequestId, input));
    const request = await this.requireProjectRequest(projectRequestId);
    if (input.taskId) {
      await this.requireProjectTask(projectRequestId, input.taskId);
    }

    const workLog = createProjectWorkLog(request, input);
    const existing = await this.getProjectWorkLog(projectRequestId, workLog.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_WORK_LOG_ALREADY_EXISTS',
        `ProjectOps project work log already exists: ${workLog.id}.`
      );
    }

    const rows = await this.sql.query<ProjectWorkLog>(insertProjectWorkLogSql(workLog));
    return await this.requireExecutionCreateWrite(rows, projectRequestId, 'work_log');
  }

  public async listProjectWorkLogs(projectRequestId: string): Promise<readonly ProjectWorkLog[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectWorkLog>(selectProjectWorkLogsSql(projectRequestId));
  }

  public async getProjectWorkLog(
    projectRequestId: string,
    workLogId: string
  ): Promise<ProjectWorkLog | undefined> {
    const rows = await this.sql.query<ProjectWorkLog>(
      selectProjectWorkLogByIdSql(projectRequestId, workLogId)
    );
    return rows[0];
  }

  public async createProjectExpense(
    projectRequestId: string,
    input: NewProjectExpenseInput
  ): Promise<ProjectExpense> {
    if (this.history) return await this.recordCommand('expense_submitted', projectRequestId, scoped => scoped.createProjectExpense(projectRequestId, input));
    validateFinanceIdentifier(projectRequestId);
    const request = await this.requireProjectRequest(projectRequestId);
    const expense = createProjectExpense(request, input);
    return this.requireFinanceWrite(await this.sql.query<ProjectExpense>(insertProjectExpenseSql(expense)), projectRequestId);
  }

  public async listProjectExpenses(projectRequestId: string): Promise<readonly ProjectExpense[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectExpense>(selectProjectExpensesSql(projectRequestId));
  }

  public async getProjectExpense(
    projectRequestId: string,
    expenseId: string
  ): Promise<ProjectExpense | undefined> {
    const rows = await this.sql.query<ProjectExpense>(
      selectProjectExpenseByIdSql(projectRequestId, expenseId)
    );
    return rows[0];
  }

  public async approveProjectExpense(
    projectRequestId: string,
    expenseId: string,
    input: DecideProjectExpenseInput
  ): Promise<ProjectExpense> {
    if (this.history) return await this.recordCommand('expense_approved', projectRequestId, scoped => scoped.approveProjectExpense(projectRequestId, expenseId, input));
    validateFinanceIdentifier(projectRequestId); validateFinanceIdentifier(expenseId);
    const parent = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectExpense(projectRequestId, expenseId);
    requireFinanceParentState(parent, 'action');
    const decided = approveProjectExpense(current, input);
    return this.requireFinanceWrite(await this.sql.query<ProjectExpense>(updateProjectExpenseDecisionSql(decided)), projectRequestId, 'expense', expenseId);
  }

  public async rejectProjectExpense(
    projectRequestId: string,
    expenseId: string,
    input: DecideProjectExpenseInput
  ): Promise<ProjectExpense> {
    if (this.history) return await this.recordCommand('expense_rejected', projectRequestId, scoped => scoped.rejectProjectExpense(projectRequestId, expenseId, input));
    validateFinanceIdentifier(projectRequestId); validateFinanceIdentifier(expenseId);
    const parent = await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectExpense(projectRequestId, expenseId);
    requireFinanceParentState(parent, 'action');
    const decided = rejectProjectExpense(current, input);
    return this.requireFinanceWrite(await this.sql.query<ProjectExpense>(updateProjectExpenseDecisionSql(decided)), projectRequestId, 'expense', expenseId);
  }

  public async createProjectActivity(
    projectRequestId: string,
    input: NewProjectActivityInput
  ): Promise<ProjectActivity> {
    if (this.history) return await this.annotateProject(projectRequestId, input.summary);
    const request = await this.requireProjectRequest(projectRequestId);
    const activity = createProjectActivity(request, input);
    const existing = await this.getProjectActivity(projectRequestId, activity.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_ACTIVITY_ALREADY_EXISTS',
        `ProjectOps project activity already exists: ${activity.id}.`
      );
    }

    const rows = await this.sql.query<ProjectActivity>(insertProjectActivitySql(activity));
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project activity insert did not return a row.');
    }
    return persisted;
  }

  public async listProjectActivities(
    projectRequestId: string
  ): Promise<readonly ProjectActivity[]> {
    await this.requireProjectRequest(projectRequestId);
    return await this.sql.query<ProjectActivity>(selectProjectActivitiesSql(projectRequestId));
  }

  public async getProjectActivity(
    projectRequestId: string,
    activityId: string
  ): Promise<ProjectActivity | undefined> {
    const rows = await this.sql.query<ProjectActivity>(
      selectProjectActivityByIdSql(projectRequestId, activityId)
    );
    return rows[0];
  }

  public async estimateProjectRequest(
    id: string,
    input: EstimateProjectRequestInput
  ): Promise<ProjectRequest> {
    if (this.history) return await this.recordCommand('request_estimated', id, scoped => scoped.estimateProjectRequest(id, input));
    const current = await this.requireProjectRequest(id);
    const revision = this.projectRevision(current, input.expectedRevision);
    const estimated = estimateProjectRequest(current, input);
    const rows = await this.sql.query<ProjectRequest>(estimateProjectRequestSql(estimated, revision, current.status));
    return this.requireControlWrite(rows);
  }

  public async approveProjectRequest(
    id: string,
    input: ApproveProjectRequestInput
  ): Promise<ProjectRequest> {
    if (this.history) return await this.recordCommand('request_approved', id, scoped => scoped.approveProjectRequest(id, input));
    const current = await this.requireProjectRequest(id);
    const revision = this.projectRevision(current, input.expectedRevision);
    const approved = approveProjectRequest(current, input);
    const rows = await this.sql.query<ProjectRequest>(approveProjectRequestSql(approved, revision));
    return this.requireControlWrite(rows);
  }

  public async transitionProjectRequest(
    id: string,
    nextStatus: ProjectRequestStatus,
    nowIso: string,
    expectedRevision?: number
  ): Promise<ProjectRequest> {
    if (this.history) return await this.recordCommand('status_changed', id, scoped => scoped.transitionProjectRequest(id, nextStatus, nowIso, expectedRevision));
    if (nextStatus === 'delivered' || nextStatus === 'archived') {
      if (!this.sql.transaction) throw new Error('Delivery and archival require a transaction-scoped ProjectOps executor.');
      return await this.sql.transaction(async sql => {
        const scoped = new ProjectOpsRepository(sql);
        // A separate statement after the lock observes children committed by the previous lock owner.
        const rows = await sql.query<ProjectRequest>(lockProjectRequestSql(id));
        const current = rows[0];
        if (!current) throw new ProjectOpsOperationError('not_found', 'PROJECTOPS_REQUEST_NOT_FOUND', `Project request not found: ${id}.`);
        const revision = scoped.projectRevision(current, expectedRevision);
        const transitioned = transitionProjectRequest(current, nextStatus, nowIso);
        if (nextStatus === 'delivered' || current.status === 'delivered') {
          const deliverables = await sql.query<ProjectDeliverable>(selectProjectDeliverablesSql(id));
          const feedback = await sql.query<ProjectFeedback>(selectProjectFeedbackSql(id));
          requireDeliveryReadiness(deliverables, feedback);
        }
        return scoped.requireControlWrite(await sql.query<ProjectRequest>(
          updateProjectRequestStatusSql(id, transitioned.status, transitioned.updatedAtIso, revision, current.status)
        ));
      });
    }
    const current = await this.requireProjectRequest(id);
    const revision = this.projectRevision(current, expectedRevision);
    const transitioned = transitionProjectRequest(current, nextStatus, nowIso);
    const rows = await this.sql.query<ProjectRequest>(
      updateProjectRequestStatusSql(id, transitioned.status, transitioned.updatedAtIso, revision, current.status)
    );
    return this.requireControlWrite(rows);
  }

  private projectRevision(current: ProjectRequest, expected?: number): number {
    const revision = current.revision ?? 1;
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1 || expected !== revision)) {
      throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_PROJECT_CHANGED', 'Project changed. Reload before trying again.');
    }
    return revision;
  }

  private async requireFinanceWrite<T>(rows: readonly T[], parentId: string, kind?: 'invoice' | 'expense', childId?: string): Promise<T> {
    if (rows[0]) return rows[0];
    // Classification only: the guarded write remains the concurrency authority.
    await this.requireProjectRequest(parentId);
    if (kind === 'invoice') await this.requireProjectInvoice(parentId, childId!);
    if (kind === 'expense') await this.requireProjectExpense(parentId, childId!);
    throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_FINANCE_CHANGED', 'Finance record or project state changed. Reload before trying again.');
  }

  private async requireDeliveryWrite<T>(rows: readonly T[], parentId: string, kind?: 'deliverable' | 'feedback', childId?: string): Promise<T> {
    if (rows[0]) return rows[0];
    await this.requireProjectRequest(parentId);
    if (kind === 'deliverable') await this.requireProjectDeliverable(parentId, childId!);
    if (kind === 'feedback') await this.requireProjectFeedback(parentId, childId!);
    throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_DELIVERY_CHANGED',
      'Delivery record or project state changed. Reload before trying again.');
  }
  private requireControlWrite(rows: readonly ProjectRequest[]): ProjectRequest {
    if (!rows[0]) throw new ProjectOpsOperationError('conflict', 'PROJECTOPS_PROJECT_CHANGED', 'Project changed. Reload before trying again.');
    return rows[0];
  }

  private planningRevision(
    currentRevision: number | undefined,
    expectedRevision: number | undefined,
    entity: 'milestone' | 'task'
  ): number {
    const current = currentRevision ?? 1;
    if (expectedRevision !== undefined) {
      requirePlanningRevision(entity, expectedRevision);
      if (expectedRevision !== current) {
        throw new ProjectOpsOperationError(
          'conflict',
          entity === 'milestone' ? 'PROJECTOPS_MILESTONE_CHANGED' : 'PROJECTOPS_TASK_CHANGED',
          `${entity === 'milestone' ? 'Milestone' : 'Task'} changed. Reload before trying again.`
        );
      }
    }
    return current;
  }

  private requirePlanningWrite<T extends ProjectMilestone | ProjectTask>(
    rows: readonly T[],
    entity: 'milestone' | 'task'
  ): T {
    if (!rows[0]) {
      throw new ProjectOpsOperationError(
        'conflict',
        entity === 'milestone' ? 'PROJECTOPS_MILESTONE_CHANGED' : 'PROJECTOPS_TASK_CHANGED',
        `${entity === 'milestone' ? 'Milestone' : 'Task'} or project state changed. Reload before trying again.`
      );
    }
    return rows[0];
  }

  private async requireExecutionCreateWrite<T>(
    rows: readonly T[],
    projectRequestId: string,
    resource: ProjectExecutionResource
  ): Promise<T> {
    if (rows[0]) return rows[0];
    const request = await this.requireProjectRequest(projectRequestId);
    throw new ProjectOpsOperationError(
      'conflict',
      'PROJECTOPS_EXECUTION_STATE_CHANGED',
      `Project state ${request.status.replaceAll('_', ' ')} does not allow this ${resource.replace('_', ' ')} command. Reload before trying again.`
    );
  }

  private async requireExecutionActionWrite<T extends ProjectIssue | ProjectRisk | ProjectDocument | ProjectNote>(
    rows: readonly T[],
    projectRequestId: string,
    childId: string,
    resource: Exclude<ProjectExecutionResource, 'work_log'>
  ): Promise<T> {
    if (rows[0]) return rows[0];
    const request = await this.requireProjectRequest(projectRequestId);
    requireExecutionActionParentState(request);
    if (resource === 'issue') await this.requireProjectIssue(projectRequestId, childId);
    if (resource === 'risk') await this.requireProjectRisk(projectRequestId, childId);
    if (resource === 'document') await this.requireProjectDocument(projectRequestId, childId);
    if (resource === 'note') await this.requireProjectNote(projectRequestId, childId);
    throw new ProjectOpsOperationError(
      'conflict',
      `PROJECTOPS_${resource.toUpperCase()}_CHANGED`,
      `${resource[0]?.toUpperCase()}${resource.slice(1)} changed. Reload before trying again.`
    );
  }

  public async getProjectExportSnapshot(id: string): Promise<ProjectExportSnapshot> {
    validateExportIdentifier(id);
    const rows = await this.sql.query<{ project_export_snapshot: unknown }>(selectProjectExportSnapshotSql(id));
    if (!rows[0]) throw new ProjectOpsOperationError('not_found', 'PROJECTOPS_REQUEST_NOT_FOUND', 'Project not found.');
    return composeProjectExportSnapshot(rows[0].project_export_snapshot);
  }

  public async getDashboard(filter: DashboardFilter = {}, evaluationNow = new Date().toISOString()): Promise<ProjectOpsDashboardView> {
    const rows = await this.sql.query<ProjectOpsDashboardRow & { hasEligibleProjects?: boolean }>(selectDashboardRowsSql(filter, evaluationNow));
    return composeProjectOpsDashboard(rows.filter(row => row.id != null), {
      filter, evaluationNow, hasEligibleProjects: rows[0]?.hasEligibleProjects,
    });
  }

  private async requireProjectRequest(id: string): Promise<ProjectRequest> {
    const currentRows = await this.sql.query<ProjectRequest>(selectProjectRequestByIdSql(id));
    const current = currentRows[0];
    if (!current) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_REQUEST_NOT_FOUND',
        `Project request not found: ${id}.`
      );
    }
    return current;
  }

  private async requireProjectMilestone(
    projectRequestId: string,
    milestoneId: string
  ): Promise<ProjectMilestone> {
    const milestone = await this.getProjectMilestone(projectRequestId, milestoneId);
    if (!milestone) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_MILESTONE_NOT_FOUND',
        `Project milestone not found: ${milestoneId}.`
      );
    }
    return milestone;
  }

  private async requireProjectDeliverable(
    projectRequestId: string,
    deliverableId: string
  ): Promise<ProjectDeliverable> {
    const deliverable = await this.getProjectDeliverable(projectRequestId, deliverableId);
    if (!deliverable) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_DELIVERABLE_NOT_FOUND',
        `Project deliverable not found: ${deliverableId}.`
      );
    }
    return deliverable;
  }

  private async requireProjectInvoice(
    projectRequestId: string,
    invoiceId: string
  ): Promise<ProjectInvoice> {
    const invoice = await this.getProjectInvoice(projectRequestId, invoiceId);
    if (!invoice) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_INVOICE_NOT_FOUND',
        `Project invoice not found: ${invoiceId}.`
      );
    }
    return invoice;
  }

  private async requireProjectChangeRequest(
    projectRequestId: string,
    changeRequestId: string
  ): Promise<ProjectChangeRequest> {
    const changeRequest = await this.getProjectChangeRequest(projectRequestId, changeRequestId);
    if (!changeRequest) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_CHANGE_REQUEST_NOT_FOUND',
        `Project change request not found: ${changeRequestId}.`
      );
    }
    return changeRequest;
  }

  private async requireProjectIssue(
    projectRequestId: string,
    issueId: string
  ): Promise<ProjectIssue> {
    const issue = await this.getProjectIssue(projectRequestId, issueId);
    if (!issue) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_ISSUE_NOT_FOUND',
        `Project issue not found: ${issueId}.`
      );
    }
    return issue;
  }

  private async requireProjectRisk(
    projectRequestId: string,
    riskId: string
  ): Promise<ProjectRisk> {
    const risk = await this.getProjectRisk(projectRequestId, riskId);
    if (!risk) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_RISK_NOT_FOUND',
        `Project risk not found: ${riskId}.`
      );
    }
    return risk;
  }

  private async requireProjectFeedback(
    projectRequestId: string,
    feedbackId: string
  ): Promise<ProjectFeedback> {
    const feedback = await this.getProjectFeedback(projectRequestId, feedbackId);
    if (!feedback) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_FEEDBACK_NOT_FOUND',
        `Project feedback not found: ${feedbackId}.`
      );
    }
    return feedback;
  }

  private async requireProjectDocument(
    projectRequestId: string,
    documentId: string
  ): Promise<ProjectDocument> {
    const document = await this.getProjectDocument(projectRequestId, documentId);
    if (!document) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_DOCUMENT_NOT_FOUND',
        `Project document not found: ${documentId}.`
      );
    }
    return document;
  }

  private async requireProjectNote(
    projectRequestId: string,
    noteId: string
  ): Promise<ProjectNote> {
    const note = await this.getProjectNote(projectRequestId, noteId);
    if (!note) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_NOTE_NOT_FOUND',
        `Project note not found: ${noteId}.`
      );
    }
    return note;
  }

  private async requireProjectTask(
    projectRequestId: string,
    taskId: string
  ): Promise<ProjectTask> {
    const task = await this.getProjectTask(projectRequestId, taskId);
    if (!task) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_TASK_NOT_FOUND',
        `Project task not found: ${taskId}.`
      );
    }
    return task;
  }

  private async requireProjectExpense(
    projectRequestId: string,
    expenseId: string
  ): Promise<ProjectExpense> {
    const expense = await this.getProjectExpense(projectRequestId, expenseId);
    if (!expense) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_EXPENSE_NOT_FOUND',
        `Project expense not found: ${expenseId}.`
      );
    }
    return expense;
  }


  private requirePersistedProjectChangeRequest(
    rows: readonly ProjectChangeRequest[],
    projectRequestId: string,
    changeRequestId: string
  ): ProjectChangeRequest {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_CHANGE_REQUEST_NOT_FOUND',
        `Project change request not found: ${projectRequestId}/${changeRequestId}.`
      );
    }
    return persisted;
  }

}
