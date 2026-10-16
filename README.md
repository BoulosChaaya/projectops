# ProjectOps

[![CI](https://github.com/BoulosChaaya/projectops/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BoulosChaaya/projectops/actions/workflows/ci.yml) [![Uptime](https://github.com/BoulosChaaya/projectops/actions/workflows/uptime.yml/badge.svg)](https://github.com/BoulosChaaya/projectops/actions/workflows/uptime.yml)

ProjectOps runs client projects from intake to payment in one application: clients, estimates and approval, planning, execution, delivery and acceptance, invoices and expenses, an automatic audit history, an operational dashboard, and project export.

**Live demo: [projectops-7p4d.onrender.com/projectops/login](https://projectops-7p4d.onrender.com/projectops/login)**. Choose **Explore the demo**. No account needed: you get a private, fully working copy of a sample studio, yours for two hours, in your own timezone ([how it is isolated](docs/decisions/ADR-003-demo-sandboxes.md)).

![The project workspace: figures and next actions on top, five tabs, history beside every tab](docs/screenshots/workspace-plan.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard.png" alt="Dashboard: lifecycle pipeline, overdue work, upcoming deadlines and outstanding invoices"></td>
    <td width="50%"><img src="docs/screenshots/workspace-money.png" alt="Money tab: totals per currency, invoices and expenses with their actions"></td>
  </tr>
  <tr>
    <td>Dashboard: where every project stands and what needs attention.</td>
    <td>Money: invoices and expenses, totalled per currency and never converted.</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/sign-in.png" alt="Sign-in page with the Explore the demo offer"></td>
    <td width="50%"><img src="docs/screenshots/workspace-overview.png" alt="Overview tab: brief, delivery readiness, finance totals and history"></td>
  </tr>
  <tr>
    <td>Sign-in, with the public demo.</td>
    <td>Overview: the brief, delivery readiness and money at a glance.</td>
  </tr>
</table>

The backend is built on raw platform primitives: Node.js's own HTTP server and hand-written parameterized SQL on PostgreSQL, with `pg` as the only runtime dependency. The interface is a React client built by Vite and served by the same server from the same origin ([ADR-002](docs/decisions/ADR-002-react-client.md)); every product page is a React page, and only the printable delivery summary stays server-rendered. Node runs the TypeScript directly by stripping types, so `pnpm verify` runs the TypeScript compiler (strict, source and tests) to actually check them.

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
- **Public demo, isolated by schema.** Each visitor gets a private copy of a seeded studio in a PostgreSQL schema of their own. Every query of a demo session runs in a transaction whose `search_path` is that schema alone, so it cannot outlive the transaction on a pooled connection and the owner's tables are not reachable at all; this needs no change to any query because all SQL names tables without a schema. Sandboxes expire, are capped, and are left out of backups. Tests prove isolation both ways, and break when either guard is removed ([ADR-003](docs/decisions/ADR-003-demo-sandboxes.md)).
- **React client on the same origin.** A Vite-built React 19 client served by the Node server under a strict CSP (scripts, styles, fonts and API calls from this origin only), typed against the domain package's own types rather than copies ([ADR-002](docs/decisions/ADR-002-react-client.md)).
- **Deploys from CI, verified live.** A merge to `main` deploys only after every suite passes: CI calls Render's deploy hook for that exact commit and passes once `/health/live` reports it. A browser smoke then runs against the live service (sign-in, access control, a full project, the public demo) and again after a redeploy to prove persistence.
- **Monitored from outside.** Every 15 minutes a scheduled workflow checks that the live service answers, its database is ready and the sign-in page is served; a lasting failure fails the run, and GitHub emails the owner. A test runs the same check against the real application and a cut-off database.
- **Testing against real infrastructure.** Native unit and contract tests, PostgreSQL acceptance tests, and Chromium browser journeys, including one 53-step project from intake to archive. CI runs all of them.

## Repository layout

```text
apps/api/        HTTP kernel (routing, body parsing, timeouts, errors), health and
                 readiness, the ProjectOps routes, runtime and operator provisioning
apps/client/     React client (Vite, TypeScript); `pnpm build` writes apps/client/dist
apps/web/        the server-rendered delivery summary; serving of the built client
packages/projectops/   domain rules, SQL, repository, migrations (packages/projectops/migrations)
packages/db/     PostgreSQL connection handling and the migration runner
packages/auth/   scrypt password hashing
packages/logger/ structured JSON logging
packages/config, http-contracts, testing-kit   small shared helpers
scripts/         integrity check, backup/restore, release packaging, deploy, deployed smoke test, uptime check
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

All 14 roadmap slices and the post-roadmap phases (hardening, deployment, the React redesign and the public demo) are complete. ProjectOps is deployed on Render (a Node web service and a private PostgreSQL 16 database, declared in [`render.yaml`](render.yaml)); `main` deploys from CI after its checks pass, and the deployed browser smoke and its after-redeploy persistence check pass against the live service. See [status](docs/projectops/status.md) for evidence per slice and [decision records](docs/decisions) for design choices.
