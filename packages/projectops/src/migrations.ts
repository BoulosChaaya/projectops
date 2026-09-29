import type { MigrationItem } from '../../db/src/migrations/index.ts';
import { projectOpsSchemaSql } from './sql.ts';

export const projectOpsFoundationMigration = Object.freeze({
  version: '0001',
  name: 'projectops_foundation',
  upSql: projectOpsSchemaSql.join(';\n\n'),
  reversible: false,
} satisfies MigrationItem);

export const projectOpsMigrations = Object.freeze([
  projectOpsFoundationMigration,
] satisfies readonly MigrationItem[]);
