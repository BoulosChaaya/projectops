import {
  ProjectOpsOperationError,
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
  type ProjectChangeRequest,
  type ProjectDeliverable,
  type ProjectDocument,
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
  composeProjectOpsDashboard,
  type ProjectOpsDashboardRow,
  type ProjectOpsDashboardView,
} from './dashboard.ts';

export interface ProjectOpsSqlExecutor {
  query<T>(statement: SqlStatement): Promise<readonly T[]>;
}

export class ProjectOpsRepository {
  private readonly sql: ProjectOpsSqlExecutor;

  constructor(sql: ProjectOpsSqlExecutor) {
    this.sql = sql;
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

  public async listClients(filter: ClientFilter = {}): Promise<readonly ProjectOpsClient[]> {
    return await this.sql.query<ProjectOpsClient>(selectClientsSql(validateClientFilter(filter)));
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

  public async listProjectRequests(): Promise<readonly ProjectRequest[]> {
    return await this.sql.query<ProjectRequest>(selectProjectRequestsSql());
  }

  public async getProjectRequest(id: string): Promise<ProjectRequest | undefined> {
    const rows = await this.sql.query<ProjectRequest>(selectProjectRequestByIdSql(id));
    return rows[0];
  }

  public async editProject(id: string, input: EditProjectInput, nowIso: string): Promise<ProjectRequest> {
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project deliverable insert did not return a row.');
    }
    return persisted;
  }

  public async listProjectDeliverables(
    projectRequestId: string
  ): Promise<readonly ProjectDeliverable[]> {
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectDeliverable(projectRequestId, deliverableId);
    const accepted = acceptProjectDeliverable(current, acceptedAtIso);
    const rows = await this.sql.query<ProjectDeliverable>(acceptProjectDeliverableSql(accepted));
    return this.requirePersistedProjectDeliverable(rows, projectRequestId, deliverableId);
  }

  public async createProjectInvoice(
    projectRequestId: string,
    input: NewProjectInvoiceInput
  ): Promise<ProjectInvoice> {
    const request = await this.requireProjectRequest(projectRequestId);
    const invoice = createProjectInvoice(request, input);
    if (invoice.deliverableId) {
      const deliverable = await this.requireProjectDeliverable(projectRequestId, invoice.deliverableId);
      if (deliverable.status !== 'accepted') {
        throw new ProjectOpsOperationError(
          'invalid_state',
          'PROJECTOPS_DELIVERABLE_NOT_ACCEPTED',
          'Project deliverable must be accepted before issuing an attached invoice.'
        );
      }
    }

    const existing = await this.getProjectInvoice(projectRequestId, invoice.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_INVOICE_ALREADY_EXISTS',
        `ProjectOps project invoice already exists: ${invoice.id}.`
      );
    }

    const rows = await this.sql.query<ProjectInvoice>(insertProjectInvoiceSql(invoice));
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project invoice insert did not return a row.');
    }
    return persisted;
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectInvoice(projectRequestId, invoiceId);
    const paid = markProjectInvoicePaid(current, paidAtIso);
    const rows = await this.sql.query<ProjectInvoice>(markProjectInvoicePaidSql(paid));
    return this.requirePersistedProjectInvoice(rows, projectRequestId, invoiceId);
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project issue insert did not return a row.');
    }
    return persisted;
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectIssue(projectRequestId, issueId);
    const resolved = resolveProjectIssue(current, input);
    const rows = await this.sql.query<ProjectIssue>(resolveProjectIssueSql(resolved));
    return this.requirePersistedProjectIssue(rows, projectRequestId, issueId);
  }

  public async createProjectRisk(
    projectRequestId: string,
    input: NewProjectRiskInput
  ): Promise<ProjectRisk> {
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project risk insert did not return a row.');
    }
    return persisted;
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectRisk(projectRequestId, riskId);
    const mitigated = mitigateProjectRisk(current, input);
    const rows = await this.sql.query<ProjectRisk>(mitigateProjectRiskSql(mitigated));
    return this.requirePersistedProjectRisk(rows, projectRequestId, riskId);
  }

  public async createProjectFeedback(
    projectRequestId: string,
    input: NewProjectFeedbackInput
  ): Promise<ProjectFeedback> {
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project feedback insert did not return a row.');
    }
    return persisted;
  }

  public async listProjectFeedback(
    projectRequestId: string
  ): Promise<readonly ProjectFeedback[]> {
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectFeedback(projectRequestId, feedbackId);
    const addressed = addressProjectFeedback(current, input);
    const rows = await this.sql.query<ProjectFeedback>(addressProjectFeedbackSql(addressed));
    return this.requirePersistedProjectFeedback(rows, projectRequestId, feedbackId);
  }

  public async createProjectDocument(
    projectRequestId: string,
    input: NewProjectDocumentInput
  ): Promise<ProjectDocument> {
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project document insert did not return a row.');
    }
    return persisted;
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectDocument(projectRequestId, documentId);
    const archived = archiveProjectDocument(current, input);
    const rows = await this.sql.query<ProjectDocument>(archiveProjectDocumentSql(archived));
    return this.requirePersistedProjectDocument(rows, projectRequestId, documentId);
  }

  public async createProjectNote(
    projectRequestId: string,
    input: NewProjectNoteInput
  ): Promise<ProjectNote> {
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project note insert did not return a row.');
    }
    return persisted;
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectNote(projectRequestId, noteId);
    const archived = archiveProjectNote(current, input);
    const rows = await this.sql.query<ProjectNote>(archiveProjectNoteSql(archived));
    return this.requirePersistedProjectNote(rows, projectRequestId, noteId);
  }

  public async createProjectTask(
    projectRequestId: string,
    input: NewProjectTaskInput
  ): Promise<ProjectTask> {
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
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project work log insert did not return a row.');
    }
    return persisted;
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
    const request = await this.requireProjectRequest(projectRequestId);
    const expense = createProjectExpense(request, input);
    const existing = await this.getProjectExpense(projectRequestId, expense.id);
    if (existing) {
      throw new ProjectOpsOperationError(
        'conflict',
        'PROJECTOPS_EXPENSE_ALREADY_EXISTS',
        `ProjectOps project expense already exists: ${expense.id}.`
      );
    }

    const rows = await this.sql.query<ProjectExpense>(insertProjectExpenseSql(expense));
    const persisted = rows[0];
    if (!persisted) {
      throw new Error('ProjectOps project expense insert did not return a row.');
    }
    return persisted;
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
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectExpense(projectRequestId, expenseId);
    const approved = approveProjectExpense(current, input);
    const rows = await this.sql.query<ProjectExpense>(updateProjectExpenseDecisionSql(approved));
    return this.requirePersistedProjectExpense(rows, projectRequestId, expenseId);
  }

  public async rejectProjectExpense(
    projectRequestId: string,
    expenseId: string,
    input: DecideProjectExpenseInput
  ): Promise<ProjectExpense> {
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectExpense(projectRequestId, expenseId);
    const rejected = rejectProjectExpense(current, input);
    const rows = await this.sql.query<ProjectExpense>(updateProjectExpenseDecisionSql(rejected));
    return this.requirePersistedProjectExpense(rows, projectRequestId, expenseId);
  }

  public async createProjectActivity(
    projectRequestId: string,
    input: NewProjectActivityInput
  ): Promise<ProjectActivity> {
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

  public async getDashboard(): Promise<ProjectOpsDashboardView> {
    const rows = await this.sql.query<ProjectOpsDashboardRow>(selectDashboardRowsSql());
    return composeProjectOpsDashboard(rows);
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

  private requirePersistedProjectRequest(
    rows: readonly ProjectRequest[],
    id: string
  ): ProjectRequest {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_REQUEST_NOT_FOUND',
        `Project request not found: ${id}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectMilestone(
    rows: readonly ProjectMilestone[],
    projectRequestId: string,
    milestoneId: string
  ): ProjectMilestone {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_MILESTONE_NOT_FOUND',
        `Project milestone not found: ${projectRequestId}/${milestoneId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectDeliverable(
    rows: readonly ProjectDeliverable[],
    projectRequestId: string,
    deliverableId: string
  ): ProjectDeliverable {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_DELIVERABLE_NOT_FOUND',
        `Project deliverable not found: ${projectRequestId}/${deliverableId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectInvoice(
    rows: readonly ProjectInvoice[],
    projectRequestId: string,
    invoiceId: string
  ): ProjectInvoice {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_INVOICE_NOT_FOUND',
        `Project invoice not found: ${projectRequestId}/${invoiceId}.`
      );
    }
    return persisted;
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

  private requirePersistedProjectIssue(
    rows: readonly ProjectIssue[],
    projectRequestId: string,
    issueId: string
  ): ProjectIssue {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_ISSUE_NOT_FOUND',
        `Project issue not found: ${projectRequestId}/${issueId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectRisk(
    rows: readonly ProjectRisk[],
    projectRequestId: string,
    riskId: string
  ): ProjectRisk {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_RISK_NOT_FOUND',
        `Project risk not found: ${projectRequestId}/${riskId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectFeedback(
    rows: readonly ProjectFeedback[],
    projectRequestId: string,
    feedbackId: string
  ): ProjectFeedback {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_FEEDBACK_NOT_FOUND',
        `Project feedback not found: ${projectRequestId}/${feedbackId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectDocument(
    rows: readonly ProjectDocument[],
    projectRequestId: string,
    documentId: string
  ): ProjectDocument {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_DOCUMENT_NOT_FOUND',
        `Project document not found: ${projectRequestId}/${documentId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectNote(
    rows: readonly ProjectNote[],
    projectRequestId: string,
    noteId: string
  ): ProjectNote {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_NOTE_NOT_FOUND',
        `Project note not found: ${projectRequestId}/${noteId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectTask(
    rows: readonly ProjectTask[],
    projectRequestId: string,
    taskId: string
  ): ProjectTask {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_TASK_NOT_FOUND',
        `Project task not found: ${projectRequestId}/${taskId}.`
      );
    }
    return persisted;
  }

  private requirePersistedProjectExpense(
    rows: readonly ProjectExpense[],
    projectRequestId: string,
    expenseId: string
  ): ProjectExpense {
    const persisted = rows[0];
    if (!persisted) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_EXPENSE_NOT_FOUND',
        `Project expense not found: ${projectRequestId}/${expenseId}.`
      );
    }
    return persisted;
  }
}
