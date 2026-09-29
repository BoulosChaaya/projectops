// EXEC-DB-045: Backward Migration
import type { MigrationRunner, MigrationResult } from './index.ts';

export async function migrateDown(
  runner: MigrationRunner,
  target: string
): Promise<MigrationResult> {
  return await runner.runDown(target);
}
