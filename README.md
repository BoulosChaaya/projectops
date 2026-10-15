# ProjectOps

ProjectOps runs client projects from intake to payment in one application: clients, estimates and approval, planning, execution, delivery and acceptance, invoices and expenses, an automatic audit history, an operational dashboard, and project export.

The backend is built on raw platform primitives: Node.js's own HTTP server and hand-written parameterized SQL on PostgreSQL, with `pg` as the only runtime dependency. The interface is moving, page by page, from server-rendered HTML to a React client built by Vite and served by the same server from the same origin ([ADR-002](docs/decisions/ADR-002-react-client.md)); sign-in, settings, the dashboard and clients are React pages so far; the project workspace is next. Node runs the TypeScript directly by stripping types, so `pnpm verify` runs the TypeScript compiler (strict, source and tests) to actually check them.

## What it does

1. **Clients:** create, search, edit and archive clients; each client lists its projects.
2. **Projects:** intake, estimate, approve, then start, hold, resume, deliver, cancel or archive through enforced state transitions.
3. **Planning and execution:** milestones, tasks, work logs, notes, document links, issues and risks.
4. **Delivery:** deliverables, client feedback and acceptance; delivery is blocked while feedback is open.
5. **Finances:** invoices, payments and expenses in integer cents, totalled separately per currency.
6. **History, dashboard, export:** every successful action is recorded with actor and time; the dashboard surfaces overdue work, deadlines and outstanding invoices; projects export as JSON with a delivery summary.

The product scope is fixed by the [roadmap](docs/projectops/roadmap.md). It serves a single operator; there are no team accounts.

## Engineering highlights

- **Concurrency control.** Clients, projects, milestones and tasks carry revisions: an edit must send the revision it read, and a conditional SQL write rejects stale ones with `409`. Every write to a project's records locks and re-checks the parent project's state in the same statement, so a write racing a cancellation either commits first or fails cleanly. Acceptance tests force these races against real PostgreSQL and assert exactly one winner.
- **Pagination.** Global lists use keyset cursors over matching indexes: each page is an indexed range read, stable under concurrent inserts, and cursors are tamper-checked. With 20,000 clients the list endpoint went from 208 ms and 4 MB to 7 ms and 10 KB per request.
- **Migrations.** Startup applies frozen SQL files in a transaction under a PostgreSQL advisory lock, with a checksum ledger. Concurrent startups serialize, edited migrations are detected, and unmanaged schemas are refused.
- **Sessions and request security.** scrypt password hashing; opaque session tokens stored only as SHA-256 hashes; 8-hour absolute and 30-minute idle expiry; persistent login rate limiting; every write requires the configured `Origin`, `application/json` and a CSRF token.
- **Failure handling.** Responses never expose internals; server errors are logged as structured JSON with their cause chain, correlation id, method and path, with credentials redacted and no query strings or row data. A database outage answers 503 with `Retry-After` rather than 500, and the application recovers on its own when PostgreSQL returns; an acceptance test cuts the database connection mid-session to prove it.
- **Recovery and release tooling.** Scripted backup (`pg_dump`) and restore into a fresh database with integrity fingerprints, and a source-runtime release packager. See [`scripts/`](scripts).
- **Testing against real infrastructure.** Native unit and contract tests, PostgreSQL acceptance tests, and Chromium browser journeys, including one 53-step project from intake to archive. CI runs all of them.

## Repository layout

```text
apps/api/        HTTP kernel (routing, body parsing, timeouts, errors), health and
                 readiness, the ProjectOps routes, runtime and operator provisioning
apps/client/     React client (Vite, TypeScript); `pnpm build` writes apps/client/dist
apps/web/        server-rendered pages not yet migrated; serving of the built client
packages/projectops/   domain rules, SQL, repository, migrations (packages/projectops/migrations)
packages/db/     PostgreSQL connection handling and the migration runner
packages/auth/   scrypt password hashing
packages/logger/ structured JSON logging
packages/config, http-contracts, testing-kit   small shared helpers
scripts/         integrity check, backup/restore, release packaging, deployed smoke test
tests/           native suites; tests/integration holds PostgreSQL and Chromium suites
docs/            roadmap, runtime guide, status, decision records
```

## Run locally

Requires Node.js 22.6+ (production uses 24.19.0), pnpm 9.12 (via Corepack) and PostgreSQL 16+.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build                              # the React client, served by the API server
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/projectops'
pnpm operator:create < operator.json   # private file: {"login": "...", "password": "..."}
pnpm start                              # http://127.0.0.1:3000/projectops/login
```

The [runtime guide](docs/projectops/runtime.md) covers configuration, HTTPS origins, operator provisioning, every workflow and its API, and backup and restore.

## Verify

```bash
pnpm verify                                   # hygiene + strict type check + client build + native tests
export PROJECTOPS_TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/projectops_test'
pnpm test:postgres                            # PostgreSQL acceptance
pnpm exec playwright install chromium
pnpm test:browser                             # Chromium journeys against PostgreSQL
```

Use a dedicated test database; the suites create and drop their own schemas.

## Status

All 14 roadmap slices are complete. ProjectOps is deployed on Render (a Node web service and a private PostgreSQL 16 database, declared in [`render.yaml`](render.yaml)); `main` deploys after CI passes, and a deployed browser smoke plus an after-redeploy persistence check passed against the live service. See [status](docs/projectops/status.md) for evidence per slice and [decision records](docs/decisions) for design choices.
