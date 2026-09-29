import {
  ProjectOpsRepository,
  type ProjectOpsSqlExecutor,
} from '../../../../packages/projectops/src/index.ts';
import type { ProjectOpsApiService } from './routes.ts';

export function createProjectOpsRepositoryService(
  sql: ProjectOpsSqlExecutor
): ProjectOpsApiService {
  return new ProjectOpsRepository(sql);
}
