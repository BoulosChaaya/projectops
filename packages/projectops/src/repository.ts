import {
  ProjectOpsOperationError,
  createClient,
  createProjectRequest,
  transitionProjectRequest,
  type NewClientInput,
  type NewProjectRequestInput,
  type ProjectOpsClient,
  type ProjectRequest,
  type ProjectRequestStatus,
} from './domain.ts';
import {
  insertClientSql,
  insertProjectRequestSql,
  selectClientByIdSql,
  selectClientsSql,
  selectDashboardRowsSql,
  selectProjectRequestByIdSql,
  selectProjectRequestsSql,
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

  public async transitionProjectRequest(
    id: string,
    nextStatus: ProjectRequestStatus,
    nowIso: string
  ): Promise<ProjectRequest> {
    const currentRows = await this.sql.query<ProjectRequest>(selectProjectRequestByIdSql(id));
    const current = currentRows[0];
    if (!current) {
      throw new ProjectOpsOperationError(
        'not_found',
        'PROJECTOPS_REQUEST_NOT_FOUND',
        `Project request not found: ${id}.`
      );
    }

    const transitioned = transitionProjectRequest(current, nextStatus, nowIso);
    const rows = await this.sql.query<ProjectRequest>(
      updateProjectRequestStatusSql(id, transitioned.status, transitioned.updatedAtIso)
    );
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

  public async getDashboard(): Promise<ProjectOpsDashboardView> {
    const rows = await this.sql.query<ProjectOpsDashboardRow>(selectDashboardRowsSql());
    return composeProjectOpsDashboard(rows);
  }
}
