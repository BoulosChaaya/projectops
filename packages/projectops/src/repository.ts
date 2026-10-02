import {
  ProjectOpsOperationError,
  acceptProjectDeliverable,
  approveProjectChangeRequest,
  approveProjectRequest,
  completeProjectMilestone,
  createProjectChangeRequest,
  createProjectActivity,
  createClient,
  createProjectDeliverable,
  createProjectInvoice,
  createProjectMilestone,
  createProjectRequest,
  estimateProjectRequest,
  markProjectInvoicePaid,
  rejectProjectChangeRequest,
  transitionProjectRequest,
  type ApproveProjectRequestInput,
  type DecideProjectChangeRequestInput,
  type EstimateProjectRequestInput,
  type NewProjectActivityInput,
  type NewProjectChangeRequestInput,
  type NewProjectDeliverableInput,
  type NewProjectInvoiceInput,
  type NewProjectMilestoneInput,
  type NewClientInput,
  type NewProjectRequestInput,
  type ProjectActivity,
  type ProjectChangeRequest,
  type ProjectDeliverable,
  type ProjectInvoice,
  type ProjectOpsClient,
  type ProjectMilestone,
  type ProjectRequest,
  type ProjectRequestStatus,
} from './domain.ts';
import {
  acceptProjectDeliverableSql,
  approveProjectRequestSql,
  completeProjectMilestoneSql,
  estimateProjectRequestSql,
  insertClientSql,
  insertProjectActivitySql,
  insertProjectChangeRequestSql,
  insertProjectDeliverableSql,
  insertProjectInvoiceSql,
  insertProjectMilestoneSql,
  insertProjectRequestSql,
  markProjectInvoicePaidSql,
  selectClientByIdSql,
  selectClientsSql,
  selectDashboardRowsSql,
  selectProjectActivitiesSql,
  selectProjectActivityByIdSql,
  selectProjectChangeRequestByIdSql,
  selectProjectChangeRequestsSql,
  selectProjectDeliverableByIdSql,
  selectProjectDeliverablesSql,
  selectProjectInvoiceByIdSql,
  selectProjectInvoicesSql,
  selectProjectMilestoneByIdSql,
  selectProjectMilestonesSql,
  selectProjectRequestByIdSql,
  selectProjectRequestsSql,
  updateProjectChangeRequestDecisionSql,
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
      throw new Error('ProjectOps project request insert did not return a row.');
    }
    return persisted;
  }

  public async listClients(): Promise<readonly ProjectOpsClient[]> {
    return await this.sql.query<ProjectOpsClient>(selectClientsSql());
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
      throw new Error('ProjectOps project milestone insert did not return a row.');
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
    completedAtIso: string
  ): Promise<ProjectMilestone> {
    await this.requireProjectRequest(projectRequestId);
    const current = await this.requireProjectMilestone(projectRequestId, milestoneId);
    const completed = completeProjectMilestone(current, completedAtIso);
    const rows = await this.sql.query<ProjectMilestone>(completeProjectMilestoneSql(completed));
    return this.requirePersistedProjectMilestone(rows, projectRequestId, milestoneId);
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
    const estimated = estimateProjectRequest(current, input);
    const rows = await this.sql.query<ProjectRequest>(estimateProjectRequestSql(estimated));
    return this.requirePersistedProjectRequest(rows, id);
  }

  public async approveProjectRequest(
    id: string,
    input: ApproveProjectRequestInput
  ): Promise<ProjectRequest> {
    const current = await this.requireProjectRequest(id);
    const approved = approveProjectRequest(current, input);
    const rows = await this.sql.query<ProjectRequest>(approveProjectRequestSql(approved));
    return this.requirePersistedProjectRequest(rows, id);
  }

  public async transitionProjectRequest(
    id: string,
    nextStatus: ProjectRequestStatus,
    nowIso: string
  ): Promise<ProjectRequest> {
    const current = await this.requireProjectRequest(id);

    const transitioned = transitionProjectRequest(current, nextStatus, nowIso);
    const rows = await this.sql.query<ProjectRequest>(
      updateProjectRequestStatusSql(id, transitioned.status, transitioned.updatedAtIso)
    );
    return this.requirePersistedProjectRequest(rows, id);
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
}
