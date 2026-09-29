// EXEC-DB-044: Forward Migration
import type { MigrationRunner, MigrationResult } from './index.ts';

export async function migrateUp(
  runner: MigrationRunner,
  target?: string
): Promise<MigrationResult> {
  return await runner.runUp(target);
}
