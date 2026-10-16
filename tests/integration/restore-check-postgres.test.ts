import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorFixture } from './operator-fixture.ts';
import { startProjectOpsPostgresApp } from '../../apps/api/src/projectops/postgres-app.ts';
import { ProjectOpsRepository } from '../../packages/projectops/src/repository.ts';
import { ProjectOpsConnectionSqlExecutor, projectOpsPoolConnection } from '../../packages/projectops/src/executor.ts';
import { checkRestore } from '../../scripts/projectops-restore-check.mjs';

const T0 = '2026-10-01T09:00:00.000Z';
const migrate = async (databaseUrl: string) => { const app = await startProjectOpsPostgresApp({ databaseUrl, host: '127.0.0.1', port: 0 }); await app.close(); };

// Two schemas stand in for the live database and Render's restored copy.
test('The restore check passes a complete restored copy and refuses the live database, an empty one or a missing schema', async () => {
  await operatorFixture(async (liveUrl, livePool) => {
    await operatorFixture(async (restoredUrl, restoredPool) => {
      await migrate(liveUrl); await migrate(restoredUrl);
      const check = () => checkRestore({ liveUrl, restoredUrl });

      let report = await check();
      assert.equal(report.ok, false); assert.deepEqual(report.problems, ['the restored database has no clients']);

      // The restored copy was taken before the live database got its second client.
      const repo = (pool: typeof livePool) => new ProjectOpsRepository(new ProjectOpsConnectionSqlExecutor(projectOpsPoolConnection(pool)));
      await repo(restoredPool).createClient({ id: 'c1', name: 'Cedar Labs', createdAtIso: T0 });
      await repo(livePool).createClient({ id: 'c1', name: 'Cedar Labs', createdAtIso: T0 });
      await repo(livePool).createClient({ id: 'c2', name: 'Harbor', createdAtIso: T0 });
      report = await check();
      assert.deepEqual([report.ok, report.problems], [true, []]);
      assert.deepEqual(report.rows.find(row => row.table === 'clients'), { table: 'clients', live: 2, restored: 1 });
      assert.ok(!report.rows.some(row => /sessions|login_limit|demo_sandboxes/.test(row.table)), 'only business tables are compared');
      assert.ok(report.rows.some(row => row.table === 'schema_migrations'));

      await assert.rejects(checkRestore({ liveUrl, restoredUrl: liveUrl }), /is the live database/);
      // The same database reached through a different URL is still the live one.
      await assert.rejects(checkRestore({ liveUrl, restoredUrl: liveUrl + '&application_name=restore-check' }), /reaches the live database/);
      await assert.rejects(checkRestore({ liveUrl: undefined as unknown as string, restoredUrl }), /DATABASE_URL is not set/);
      await assert.rejects(checkRestore({ liveUrl, restoredUrl: undefined as unknown as string }), /RESTORE_DATABASE_URL is not set/);
      await assert.rejects(checkRestore({ liveUrl, restoredUrl: 'postgres://nobody:secret-password@127.0.0.1:1/none' }), (error: Error) =>
        /Could not connect to the restored database\.$/.test(error.message) && !error.message.includes('secret-password'));

      // A restore that lost a table, or holds an older schema, fails and names it.
      await restoredPool.query('DROP TABLE projectops_project_expenses');
      await restoredPool.query("DELETE FROM projectops_schema_migrations WHERE version = (SELECT max(version) FROM projectops_schema_migrations)");
      report = await check();
      assert.equal(report.ok, false);
      assert.match(report.problems.join('\n'), /migrations: restored has \d+, this code has \d+/);
      assert.match(report.problems.join('\n'), /tables missing from the restored database: projectops_project_expenses/);
    });
  });
});
