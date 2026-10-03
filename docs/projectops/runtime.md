# Running ProjectOps with PostgreSQL

Requires Node 22.6+ (Node 22 recommended), pnpm and PostgreSQL 16+. This runtime is a local engineering checkpoint; operator access is the next roadmap slice.

```bash
pnpm install --frozen-lockfile
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/projectops'
pnpm start
```

Keep actual credentials outside git. Configure PostgreSQL TLS through the connection URL; certificate verification is not disabled by application code. HOST defaults to 127.0.0.1 and PORT to 3000. The database must already exist. Open /projectops for the summary dashboard; API routes are under /projectops. SIGINT/SIGTERM close the HTTP server and database pool.

Startup applies the frozen migration artifacts in a transaction and records their names/checksums in projectops_schema_migrations. Concurrent startup is serialized. Subsequent startup verifies and skips applied versions. Do not edit an applied artifact; add and register the next version. Startup refuses existing ProjectOps tables without a ledger: back up and prepare an explicit legacy migration before using such a database.

## Verification

```bash
pnpm verify
export PROJECTOPS_TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/projectops_test'
pnpm test:postgres
```

The PostgreSQL acceptance command fails if its URL is missing. It creates unique test schemas and removes only those schemas afterward. Use a dedicated test database and a role allowed to create schemas. It checks API writes and dashboard reads across application restart, simultaneous migration startup, a new migration version, checksum drift, transactional rollback and unmanaged-schema refusal. GitHub Actions runs it against PostgreSQL 16.
