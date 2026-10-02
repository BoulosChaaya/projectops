import type { RawQueryResult } from '../../db/src/connection/connect.ts';
import { ProjectOpsOperationError } from './domain.ts';
import type { ProjectOpsSqlExecutor } from './repository.ts';
import type { SqlStatement } from './sql.ts';

type ProjectOpsTable = 'projectops_clients' | 'projectops_project_requests';

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
      return Object.freeze(result.rows);
    } catch (error) {
      throw mapProjectOpsStorageError(error, statement);
    }
  }
}

export class ProjectOpsMemorySqlExecutor implements ProjectOpsSqlExecutor {
  private readonly clients = new Map<string, ProjectOpsClientRow>();
  private readonly projectRequests = new Map<string, ProjectOpsRequestRow>();
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
  }> {
    return Object.freeze({
      clients: Object.freeze([...this.clients.values()].map((row) => Object.freeze({ ...row }))),
      projectRequests: Object.freeze(
        [...this.projectRequests.values()].map((row) => Object.freeze({ ...row }))
      ),
    });
  }

  private assertMigrated(): void {
    if (
      !this.migratedTables.has('projectops_clients') ||
      !this.migratedTables.has('projectops_project_requests')
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
      priority: asString(params[6], 'projectRequest.priority'),
      status: asString(params[7], 'projectRequest.status'),
      createdAtIso: asString(params[8], 'projectRequest.createdAtIso'),
      updatedAtIso: asString(params[9], 'projectRequest.updatedAtIso'),
    } satisfies ProjectOpsRequestRow);

    if (this.projectRequests.has(row.id)) {
      throw new Error(`Duplicate ProjectOps project request id: ${row.id}`);
    }
    this.projectRequests.set(row.id, row);
    return row;
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
            updatedAtIso: request.updatedAtIso,
          });
        })
    );
  }
}

function toClient(row: ProjectOpsClientRow): ProjectOpsClientRow {
  return Object.freeze({ ...row });
}

function toProjectRequest(row: ProjectOpsRequestRow): ProjectOpsRequestRow {
  return Object.freeze({ ...row });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
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
  readonly priority: string;
  readonly status: string;
  readonly createdAtIso: string;
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
  readonly updatedAtIso: string;
}
