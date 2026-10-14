# ProjectOps AI Context

Read this before changing anything. ProjectOps is a client and project operations application for a single operator, built on raw Node.js and PostgreSQL. Its scope is fixed by [the roadmap](docs/projectops/roadmap.md); [status](docs/projectops/status.md) is the engineering handoff and must stay evidence-based.

## Technology invariants

1. **No frameworks or ORMs.** Node.js's HTTP server, Web Platform APIs and hand-written parameterized SQL. Adding any runtime dependency, framework or SDK requires an explicit owner decision recorded in `docs/decisions`. Today `pg` is the only runtime dependency ([ADR-001](docs/decisions/ADR-001-projectops-postgres-transport.md)).
2. **Persistence.** Product SQL lives in `packages/projectops/src` (mostly `sql.ts`; operator sessions in `operator.ts`); queries are always parameterized. Schema changes are new files in `packages/projectops/migrations/`, registered in `postgres-migrations.ts`. Never edit an applied migration; startup verifies checksums.
3. **Lists.** Global list endpoints return `{ items, nextCursor }` pages via `packages/projectops/src/pagination.ts`: keyset cursors with an index matching the sort order. Never return an unbounded global list.
4. **Concurrency.** Edits to clients, projects, milestones and tasks send `expectedRevision`; writes to a project's records lock and re-check the parent project in the same statement. New write paths must keep both guarantees and be covered by a PostgreSQL race test.
5. **Time.** Application timestamps come from an injected clock (`ProjectOpsRuntimeConfig.clock` in tests, the wall clock in production). Tests must not depend on the current date.
6. **Security boundary.** Every product route is protected by operator sessions; writes require the configured `Origin`, `application/json` and the session's CSRF token. Stored user text is rendered as text, never HTML.
7. **Types.** Node strips types without checking them; `tsc` (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`) is the only checker and runs in `pnpm verify`. Keep it at zero errors. Use `import type` for type-only imports, and give `Object.freeze` an explicit type when freezing handlers or tables, or their contents lose type checking.
8. **Testing.** Node's built-in `node:test` and `node:assert/strict`. Behavior that touches persistence needs PostgreSQL acceptance coverage, not only memory-executor tests.

## Repository layout

- `apps/api`: HTTP kernel, health and readiness, ProjectOps routes, PostgreSQL runtime (`src/projectops/postgres-app.ts`), entry point `src/projectops/main.ts`
- `apps/web/src/projectops`: server-rendered pages and browser scripts
- `packages/projectops`: domain rules, SQL, repository, migrations, export and dashboard logic
- `packages/db`: PostgreSQL connection handling and the migration runner
- `packages/auth`: scrypt password hashing
- `packages/logger`: structured JSON logging
- `packages/config`, `packages/http-contracts`, `packages/testing-kit`: small shared helpers
- `scripts`: integrity check, backup/restore, release packaging, deployed smoke test
- `tests`: native suites; `tests/integration` holds PostgreSQL and Chromium suites

## Working rules

- Work on a branch and open a pull request; `main` is protected and only the owner merges.
- Make the smallest change that satisfies the approved task. Stop and ask before widening scope, changing architecture or adding dependencies.
- Commit messages explain what changed, why, and the evidence.
- Before claiming a change works, run `pnpm verify`, `pnpm test:postgres` and `pnpm test:browser`, and report exactly what ran and what passed. Never claim deployment or live-provider behavior that was not observed.
- Never commit secrets. Test databases use disposable credentials.
