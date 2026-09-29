import type { ProjectOpsSqlExecutor } from './repository.ts';
import { projectOpsSchemaSql } from './sql.ts';

export async function applyProjectOpsMigrations(sql: ProjectOpsSqlExecutor): Promise<void> {
  for (const statement of projectOpsSchemaSql) {
    await sql.query({
      sql: statement,
      params: Object.freeze([]),
    });
  }
}
