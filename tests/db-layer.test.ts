// Verification Suite for Layer 2: DB (EXEC-DB-001 .. EXEC-DB-061: Persistent Storage Available)
import { unitTest, assert } from '../packages/testing-kit/src/unit/index.ts';
import {
  connectDatabase,
  type DriverSocketConnection,
  type RawQueryResult,
} from '../packages/db/src/connection/connect.ts';
import { classifyConnectionFailure } from '../packages/db/src/connection-resilience/failure.ts';
import { retryTransientConnection } from '../packages/db/src/connection-resilience/retry.ts';
import { ConnectionCircuitBreaker } from '../packages/db/src/connection-resilience/circuit-breaker.ts';
import { createPool } from '../packages/db/src/pool/initialize.ts';
import { queryDeadlineCancellation } from '../packages/db/src/query-deadline/index.ts';
import { defineEntity } from '../packages/db/src/schema/entities.ts';
import { defineRelationship } from '../packages/db/src/schema/relationships.ts';
import { defineConstraint } from '../packages/db/src/schema/constraints.ts';
import { compileSchemaDdl, detectSchemaDrift } from '../packages/db/src/schema/index.ts';
import { validateWrite } from '../packages/db/src/integrity/write-validation.ts';
import { createWriteRepository } from '../packages/db/src/writes/index.ts';
import { createReadRepository } from '../packages/db/src/reads/index.ts';
import { compileQuerySpec } from '../packages/db/src/repository/query-spec.ts';
import { createDomainPersistencePort } from '../packages/db/src/repository/index.ts';
import { withTransaction } from '../packages/db/src/transactions/boundary.ts';
import { OptimisticLock } from '../packages/db/src/concurrency/optimistic-lock.ts';
import { PessimisticLock } from '../packages/db/src/concurrency/pessimistic-lock.ts';
import { executeWithDeadlockRecovery } from '../packages/db/src/concurrency/deadlock-recovery.ts';
import { MigrationRunner } from '../packages/db/src/migrations/index.ts';
import { migrateUp } from '../packages/db/src/migrations/forward.ts';
import { migrateDown } from '../packages/db/src/migrations/backward.ts';
import { applicationSchemaCompatibility } from '../packages/db/src/migrations/compatibility.ts';
import { QueryPerformanceProbe } from '../packages/db/src/query-performance/index.ts';
import { estimateQueryCost } from '../packages/db/src/query-performance/cost.ts';
import { detectNPlusOne } from '../packages/db/src/query-performance/n-plus-one.ts';
import { estimateIndexMaintenance } from '../packages/db/src/indexing/maintenance-cost.ts';
import { buildCompositeIndexColumns } from '../packages/db/src/indexing/composite.ts';
import { QueryPlanAnalyzer } from '../packages/db/src/query-plan/index.ts';
import { SlowQueryMonitor } from '../packages/db/src/slow-query/index.ts';

/**
 * Disposable Stateful PostgreSQL Engine Simulator for deterministic integration tests
 * (Supports tables, unique constraints, transactions, rollback, optimistic versions, and EXPLAIN).
 */
class DisposablePostgresState {
  public readonly tables = new Map<string, Array<Record<string, unknown>>>();
  public readonly uniqueKeys = new Map<string, string[]>();
  public readonly indexes = new Set<string>();
  private connCounter = 0;

  public createDriverConnection(options: { delayMs?: number } = {}): DriverSocketConnection {
    const id = `pg-conn-${++this.connCounter}`;
    let open = true;
    let txSnapshot: Map<string, Array<Record<string, unknown>>> | null = null;

    const cloneTables = (src: Map<string, Array<Record<string, unknown>>>) => {
      const copy = new Map<string, Array<Record<string, unknown>>>();
      for (const [k, rows] of src.entries()) {
        copy.set(
          k,
          rows.map((r) => ({ ...r }))
        );
      }
      return copy;
    };

    return {
      id,
      isOpen: () => open,
      close: async () => {
        open = false;
      },
      query: async <TRow = Record<string, unknown>>(
        sql: string,
        params: readonly unknown[] = []
      ): Promise<RawQueryResult<TRow>> => {
        if (!open) throw new Error('Connection is closed.');
        if (options.delayMs) {
          await new Promise((r) => setTimeout(r, options.delayMs));
        }

        const norm = sql.trim();
        const upper = norm.toUpperCase();

        if (upper.includes('SELECT VERSION()')) {
          return {
            rows: [{ server_version: 'PostgreSQL 16.4', database_name: 'uruk_test' } as unknown as TRow],
            rowCount: 1,
            command: 'SELECT',
          };
        }

        if (upper === 'SELECT 1 AS OK') {
          return { rows: [{ ok: 1 } as unknown as TRow], rowCount: 1, command: 'SELECT' };
        }

        if (upper.startsWith('BEGIN')) {
          txSnapshot = cloneTables(this.tables);
          return { rows: [], rowCount: 0, command: 'BEGIN' };
        }

        if (upper === 'COMMIT') {
          txSnapshot = null;
          return { rows: [], rowCount: 0, command: 'COMMIT' };
        }

        if (upper === 'ROLLBACK') {
          if (txSnapshot) {
            this.tables.clear();
            for (const [k, v] of txSnapshot.entries()) {
              this.tables.set(k, v);
            }
            txSnapshot = null;
          }
          return { rows: [], rowCount: 0, command: 'ROLLBACK' };
        }

        if (upper.startsWith('CREATE TABLE')) {
          const match = norm.match(/CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)/i);
          const tbl = match ? match[1] : 'unknown';
          if (!this.tables.has(tbl)) {
            this.tables.set(tbl, []);
          }
          if (upper.includes('UNIQUE') || tbl === 'accounts') {
            this.uniqueKeys.set(tbl, ['email']);
          }
          return { rows: [], rowCount: 0, command: 'CREATE' };
        }

        if (upper.startsWith('DROP TABLE')) {
          const match = norm.match(/DROP\s+TABLE\s+([a-z_][a-z0-9_]*)/i);
          if (match) this.tables.delete(match[1]);
          return { rows: [], rowCount: 0, command: 'DROP' };
        }

        if (upper.startsWith('EXPLAIN')) {
          const hasIdx = this.indexes.size > 0;
          return {
            rows: [
              {
                startupCost: 0.15,
                totalCost: hasIdx ? 4.25 : 50.0,
                estimatedRows: 1,
                scanType: hasIdx ? 'Index Scan' : 'Seq Scan',
                relationName: 'accounts',
              } as unknown as TRow,
            ],
            rowCount: 1,
            command: 'EXPLAIN',
          };
        }

        if (upper.startsWith('INSERT INTO')) {
          const match = norm.match(/INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]+)\)/i);
          const tbl = match![1];
          const cols = match![2].split(',').map((c) => c.trim());
          const row: Record<string, unknown> = {};
          cols.forEach((c, idx) => {
            row[c] = params[idx];
          });
          if (row.version === undefined) row.version = 1;

          const tableRows = this.tables.get(tbl) ?? [];
          const uniques = this.uniqueKeys.get(tbl) ?? [];
          for (const uCol of uniques) {
            if (row[uCol] !== undefined && tableRows.some((existing) => existing[uCol] === row[uCol])) {
              const err = new Error(`duplicate key value violates unique constraint "${tbl}_${uCol}_key"`);
              (err as { code?: string; constraint?: string }).code = '23505';
              (err as { constraint?: string }).constraint = `${tbl}_${uCol}_key`;
              throw err;
            }
          }

          tableRows.push(row);
          this.tables.set(tbl, tableRows);
          return { rows: [{ ...row } as unknown as TRow], rowCount: 1, command: 'INSERT' };
        }

        if (upper.startsWith('UPDATE')) {
          const tblMatch = norm.match(/UPDATE\s+([a-z_][a-z0-9_]*)/i);
          const tbl = tblMatch![1];
          const tableRows = this.tables.get(tbl) ?? [];
          const id = params[params.length - 2];
          const expectedVersion = params[params.length - 1];
          const target = tableRows.find((r) => r.id === id && r.version === expectedVersion);
          if (!target) {
            return { rows: [], rowCount: 0, command: 'UPDATE' };
          }
          target.email = params[0];
          target.version = Number(target.version) + 1;
          return { rows: [{ ...target } as unknown as TRow], rowCount: 1, command: 'UPDATE' };
        }

        if (upper.startsWith('SELECT COUNT(*)')) {
          const tblMatch = norm.match(/FROM\s+([a-z_][a-z0-9_]*)/i);
          const tbl = tblMatch![1];
          const tableRows = this.tables.get(tbl) ?? [];
          return {
            rows: [{ count: tableRows.length, value: tableRows.length } as unknown as TRow],
            rowCount: 1,
            command: 'SELECT',
          };
        }

        if (upper.startsWith('SELECT')) {
          const tblMatch = norm.match(/FROM\s+([a-z_][a-z0-9_]*)/i);
          const tbl = tblMatch ? tblMatch[1] : 'accounts';
          let rows = [...(this.tables.get(tbl) ?? [])];

          if (upper.includes('WHERE ID = $1')) {
            rows = rows.filter((r) => r.id === params[0]);
          } else if (upper.includes('WHERE EMAIL = $1')) {
            rows = rows.filter((r) => r.email === params[0]);
          }

          if (upper.includes('ORDER BY')) {
            rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          }

          if (upper.includes('LIMIT $')) {
            const limit = Number(params[params.length - 2]);
            const offset = Number(params[params.length - 1]);
            rows = rows.slice(offset, offset + limit);
          } else if (upper.includes('LIMIT 1')) {
            rows = rows.slice(0, 1);
          }

          return {
            rows: rows.map((r) => ({ ...r }) as unknown as TRow),
            rowCount: rows.length,
            command: 'SELECT',
          };
        }

        return { rows: [], rowCount: 0, command: 'OK' };
      },
    };
  }
}

unitTest('EXEC-DB-001..006: Connection handshake, timeout, SSL ambiguity, failure classification, retries & circuit breaker', async () => {
  const pgState = new DisposablePostgresState();

  // 1. Handshake & valid connection
  const conn = await connectDatabase({
    connectionString: 'postgres://uruk:secret@localhost:5432/uruk_test',
    driverFactory: async () => pgState.createDriverConnection(),
  });
  assert.equal(conn.identity.majorVersion, 16);
  await conn.close();

  // 2. SSL ambiguity rejection
  await assert.rejects(
    () =>
      connectDatabase({
        connectionString: 'postgres://uruk:secret@localhost:5432/uruk_test?sslmode=require',
        ssl: { mode: 'verify-full' },
        driverFactory: async () => pgState.createDriverConnection(),
      }),
    /Ambiguous SSL configuration/
  );

  // 3. Connection timeout cancellation
  await assert.rejects(
    () =>
      connectDatabase({
        connectionString: 'postgres://uruk:secret@localhost:5432/uruk_test',
        connectTimeoutMs: 20,
        driverFactory: async () => {
          await new Promise((r) => setTimeout(r, 120));
          return pgState.createDriverConnection();
        },
      }),
    (err: Error) => err.name === 'DatabaseConnectTimeoutError'
  );

  // 4. Failure classification & transient retry
  let attempts = 0;
  const recovered = await retryTransientConnection(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const netErr = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
        throw netErr;
      }
      return 'connected';
    },
    { maxAttempts: 3, baseDelayMs: 1 }
  );
  assert.equal(recovered, 'connected');
  assert.equal(attempts, 3);

  const authFailure = classifyConnectionFailure(Object.assign(new Error('bad auth'), { code: '28P01' }));
  assert.equal(authFailure.category, 'authentication');
  assert.equal(authFailure.transient, false);

  // 5. Circuit breaker transitions (closed -> open -> half_open -> closed)
  let clockMs = 1000;
  const breaker = new ConnectionCircuitBreaker({
    failureThreshold: 2,
    recoveryIntervalMs: 5000,
    clock: () => clockMs,
  });

  await assert.rejects(() => breaker.execute(async () => { throw new Error('fail 1'); }));
  assert.equal(breaker.getState(), 'closed');
  await assert.rejects(() => breaker.execute(async () => { throw new Error('fail 2'); }));
  assert.equal(breaker.getState(), 'open');

  // Open rejects fast
  await assert.rejects(() => breaker.execute(async () => 'ok'), /circuit breaker is OPEN/);

  // Advance clock past recovery interval -> half_open -> success closes breaker
  clockMs += 6000;
  assert.equal(breaker.getState(), 'half_open');
  const probeOk = await breaker.execute(async () => 'recovered');
  assert.equal(probeOk, 'recovered');
  assert.equal(breaker.getState(), 'closed');
});

unitTest('EXEC-DB-007..014: Bounded pool, exclusive lease, exhaustion, query deadline cancellation, and clean shutdown', async () => {
  const pgState = new DisposablePostgresState();
  const pool = await createPool({
    connectionString: 'postgres://uruk:secret@localhost:5432/uruk_test',
    min: 1,
    max: 2,
    acquireTimeoutMs: 40,
    driverFactory: async () => pgState.createDriverConnection(),
  });

  try {
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    assert.notEqual(c1.id, c2.id);
    assert.equal(pool.getMetrics().active, 2);

    // Pool saturated -> 3rd acquire times out with PoolExhaustedError
    await assert.rejects(
      () => pool.acquire(),
      (err: Error) => err.name === 'PoolExhaustedError'
    );

    // Release c1 twice (idempotent double-release protection)
    c1.release();
    c1.release();
    c2.release();

    // Query deadline cancellation (EXEC-DB-014)
    const slowPool = await createPool({
      connectionString: 'postgres://uruk:secret@localhost:5432/uruk_test',
      max: 1,
      driverFactory: async () => pgState.createDriverConnection({ delayMs: 120 }),
    });
    await assert.rejects(
      () => queryDeadlineCancellation(slowPool, 'SELECT 1 AS ok', [], 20),
      (err: Error) => err.name === 'QueryDeadlineError'
    );
    await slowPool.close();
  } finally {
    await pool.close();
    assert.equal(pool.getMetrics().total, 0);
  }
});

unitTest('EXEC-DB-015..061: Migrations, Schema, Writes, Reads, Transactions, Locks, Query Plans & Slow Query Monitor', async () => {
  const pgState = new DisposablePostgresState();
  const pool = await createPool({
    connectionString: 'postgres://uruk:secret@localhost:5432/uruk_test',
    min: 1,
    max: 4,
    driverFactory: async () => pgState.createDriverConnection(),
  });

  try {
    const conn = await pool.acquire();

    // 1. Schema & Migrations (EXEC-DB-015..018, 042..047)
    const accountEntity = defineEntity('accounts', [
      { name: 'id', type: 'text', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false },
      { name: 'version', type: 'integer', nullable: false, defaultExpression: '1' },
    ]);
    const rel = defineRelationship({
      name: 'fk_orders_account',
      kind: 'one-to-many',
      sourceTable: 'orders',
      sourceColumn: 'account_id',
      targetTable: 'accounts',
      targetColumn: 'id',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
    const constraint = defineConstraint({
      name: 'accounts_email_unique',
      tableName: 'accounts',
      kind: 'UNIQUE',
      columns: ['email'],
    });
    const ddl = compileSchemaDdl({
      version: '0001',
      entities: [accountEntity],
      relationships: [rel],
      constraints: [constraint],
    });

    const runner = new MigrationRunner(conn, [
      {
        version: '0001',
        name: '0001_create_accounts.sql',
        upSql: ddl[0],
        downSql: 'DROP TABLE accounts;',
        reversible: true,
      },
    ]);

    // Concurrent migration runners serialize via advisory lock (EXEC-DB-043)
    const [m1, m2] = await Promise.all([migrateUp(runner), migrateUp(runner)]);
    assert.equal(m1.applied.length + m2.applied.length, 1);
    assert.equal(m1.currentVersion, '0001');
    assert.deepEqual(detectSchemaDrift({ version: '0001', entities: [accountEntity], relationships: [], constraints: [] }, ['accounts']), []);

    const compat = applicationSchemaCompatibility(
      { appVersion: '1.0.0', supportedSchemaVersions: ['0001'] },
      m1.currentVersion
    );
    assert.equal(compat.compatible, true);

    // 2. Write validation, Single/Bulk Writes, Unique Conflict & Reads (EXEC-DB-019..029, 038..041)
    assert.throws(() => validateWrite({ id: 'acc-1' }, accountEntity), /Write validation failed/);

    const writer = createWriteRepository(conn, 'accounts');
    await writer.insertOne({ id: 'acc-1', email: 'enki@uruk.dev', version: 1 });
    await writer.insertMany([
      { id: 'acc-2', email: 'inanna@uruk.dev', version: 1 },
      { id: 'acc-3', email: 'gilgamesh@uruk.dev', version: 1 },
    ]);

    // Duplicate email -> WriteConflictError (EXEC-DB-022 & 039)
    await assert.rejects(
      () => writer.insertOne({ id: 'acc-dup', email: 'enki@uruk.dev', version: 1 }),
      (err: Error) => err.name === 'WriteConflictError'
    );

    const reader = createReadRepository<{ id: string; email: string; version: number }>(conn, 'accounts');
    const single = await reader.findOne({ email: 'enki@uruk.dev' });
    assert.equal(single?.id, 'acc-1');

    const page1 = await reader.findPage({ orderBy: 'id', limit: 2, offset: 0 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.hasMore, true);

    const agg = await reader.aggregate({ operation: 'COUNT' });
    assert.equal(agg.count, 3);

    // QuerySpec & DomainPersistencePort (EXEC-DB-027..029)
    const specSql = compileQuerySpec<{ id: string; email: string }>({
      table: 'accounts',
      allowedFields: ['id', 'email'],
      criteria: [{ field: 'email', operator: '=', value: 'inanna@uruk.dev' }],
    });
    assert.equal(specSql.sql, 'SELECT * FROM accounts WHERE email = $1');

    const domainPort = createDomainPersistencePort<{ accountId: string; emailAddress: string }>(
      conn,
      'accounts',
      {
        accountId: { column: 'id' },
        emailAddress: { column: 'email', transform: (v) => String(v).toUpperCase() },
      }
    );
    const mapped = await domainPort.findById('acc-1');
    assert.deepEqual(mapped, { accountId: 'acc-1', emailAddress: 'ENKI@URUK.DEV' });

    // 3. Transactions & Leaked Context Deactivation (EXEC-DB-030..033)
    let leakedTx: { query: (sql: string) => Promise<unknown> } | undefined;
    await assert.rejects(
      () =>
        withTransaction(pool, async (tx) => {
          leakedTx = tx;
          await tx.query("INSERT INTO accounts (id, email, version) VALUES ($1, $2, $3)", [
            'acc-rolled-back',
            'rollback@uruk.dev',
            1,
          ]);
          throw new Error('Abort transaction');
        }),
      /Abort transaction/
    );

    // Verify rollback removed the record and leaked transaction client is deactivated
    assert.equal(await reader.findOne({ id: 'acc-rolled-back' }), null);
    await assert.rejects(() => leakedTx!.query('SELECT 1'), /no longer active/);

    // 4. Optimistic Lock, Pessimistic Lock & Deadlock Recovery (EXEC-DB-034..037)
    const updated = await OptimisticLock(conn, {
      table: 'accounts',
      id: 'acc-1',
      expectedVersion: 1,
      changes: { email: 'enki-v2@uruk.dev' },
    });
    assert.equal(updated.version, 2);

    // Stale version fails with WriteConflictError
    await assert.rejects(
      () =>
        OptimisticLock(conn, {
          table: 'accounts',
          id: 'acc-1',
          expectedVersion: 1,
          changes: { email: 'stale@uruk.dev' },
        }),
      (err: Error) => err.name === 'WriteConflictError'
    );

    await withTransaction(pool, async (tx) => {
      const locked = await PessimisticLock(tx, 'accounts', 'acc-1', 'NOWAIT');
      assert.equal((locked as { id: string }).id, 'acc-1');
    });

    let deadlockTries = 0;
    const deadlockResolved = await executeWithDeadlockRecovery(
      async () => {
        deadlockTries += 1;
        if (deadlockTries === 1) {
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        }
        return 'committed-after-deadlock';
      },
      { retrySafe: true, maxAttempts: 3 }
    );
    assert.equal(deadlockResolved, 'committed-after-deadlock');

    // 5. Query Performance, N+1, Indexing, Plan Regression & Slow Query Monitor (EXEC-DB-048..060)
    const probe = new QueryPerformanceProbe();
    for (let i = 0; i < 6; i += 1) {
      probe.record('orders.byAccount', `SELECT * FROM orders WHERE account_id = '${i}'`, 5, 1);
    }
    const nPlusOne = detectNPlusOne(probe.getTraces(), 5);
    assert.equal(nPlusOne.length, 1);

    const compCols = buildCompositeIndexColumns({
      name: 'idx_accounts_email_created',
      table: 'accounts',
      equalityColumns: ['email'],
      rangeOrSortColumns: ['created_at'],
    });
    assert.deepEqual(compCols, ['email', 'created_at']);

    const maint = estimateIndexMaintenance([
      { name: 'idx_a', table: 'accounts', columns: ['email'] },
      { name: 'idx_a_b', table: 'accounts', columns: ['email', 'id'] },
    ]);
    assert.equal(maint[0].redundantWith, 'idx_a_b');

    pgState.indexes.add('idx_accounts_email');
    const baselinePlan = await QueryPlanAnalyzer.explain(conn, 'SELECT * FROM accounts WHERE email = $1', ['a']);
    const cost = await estimateQueryCost(conn, 'SELECT * FROM accounts WHERE email = $1', ['a']);
    assert.equal(cost.scanType, 'Index Scan');

    pgState.indexes.clear();
    const degradedPlan = await QueryPlanAnalyzer.explain(conn, 'SELECT * FROM accounts WHERE email = $1', ['a']);
    const regression = QueryPlanAnalyzer.detectPlanRegression(baselinePlan, degradedPlan);
    assert.equal(regression?.reason, 'index_to_seq_scan_degradation');

    const slowMonitor = new SlowQueryMonitor(100);
    assert.equal(
      slowMonitor.observe({
        sql: "SELECT * FROM accounts WHERE email = 'secret@uruk.dev'",
        durationMs: 50,
        operationName: 'fastOp',
      }),
      null
    );
    const slowRec = slowMonitor.observe({
      sql: "SELECT * FROM accounts WHERE email = 'secret@uruk.dev'",
      durationMs: 250,
      operationName: 'slowOp',
      correlationId: 'corr-db-1',
    });
    assert.ok(slowRec);
    assert.equal(JSON.stringify(slowRec).includes('secret@uruk.dev'), false);

    // 6. Reversible backward migration (EXEC-DB-045)
    const downRes = await migrateDown(runner, '0000');
    assert.equal(downRes.currentVersion, null);

    conn.release();
  } finally {
    await pool.close();
  }
});
