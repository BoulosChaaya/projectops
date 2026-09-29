import {
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
  selectDashboardRowsSql,
  selectProjectRequestByIdSql,
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
    const rows = await this.sql.query<ProjectOpsClient>(insertClientSql(client));
    return rows[0] ?? client;
  }

  public async createProjectRequest(input: NewProjectRequestInput): Promise<ProjectRequest> {
    const request = createProjectRequest(input);
    const rows = await this.sql.query<ProjectRequest>(insertProjectRequestSql(request));
    return rows[0] ?? request;
  }

  public async transitionProjectRequest(
    id: string,
    nextStatus: ProjectRequestStatus,
    nowIso: string
  ): Promise<ProjectRequest> {
    const currentRows = await this.sql.query<ProjectRequest>(selectProjectRequestByIdSql(id));
    const current = currentRows[0];
    if (!current) {
      throw new Error(`Project request not found: ${id}`);
    }

    const transitioned = transitionProjectRequest(current, nextStatus, nowIso);
    const rows = await this.sql.query<ProjectRequest>(
      updateProjectRequestStatusSql(id, transitioned.status, transitioned.updatedAtIso)
    );
    return rows[0] ?? transitioned;
  }

  public async getDashboard(): Promise<ProjectOpsDashboardView> {
    const rows = await this.sql.query<ProjectOpsDashboardRow>(selectDashboardRowsSql());
    return composeProjectOpsDashboard(rows);
  }
}
