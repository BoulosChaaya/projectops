# ProjectOps AI Context

Read this before changing anything. ProjectOps is a client and project operations application for a single operator, built on raw Node.js and PostgreSQL. Its scope is fixed by [the roadmap](docs/projectops/roadmap.md); [status](docs/projectops/status.md) is the engineering handoff and must stay evidence-based.

## Technology invariants

1. **No server frameworks or ORMs.** Node.js's HTTP server, Web Platform APIs and hand-written parameterized SQL. Adding any runtime dependency, framework or SDK requires an explicit owner decision recorded in `docs/decisions`. Today `pg` is the only runtime dependency ([ADR-001](docs/decisions/ADR-001-projectops-postgres-transport.md)). The browser client is React built by Vite ([ADR-002](docs/decisions/ADR-002-react-client.md)); its libraries are build-time devDependencies, and adding another client library is also an owner decision.
2. **Persistence.** Product SQL lives in `packages/projectops/src` (mostly `sql.ts`; operator sessions in `operator.ts`); queries are always parameterized. Responses are camelCase domain objects: a new multi-word column needs an explicit mapping in `normalizeProjectOpsRow` (executor.ts), or it will be missing from responses; never pass raw columns through. `contract-postgres.test.ts` enforces this. Schema changes are new files in `packages/projectops/migrations/`, registered in `postgres-migrations.ts`. Never edit an applied migration; startup verifies checksums. Deploys overlap old and new code for about a minute, so a migration must keep the previous release working: add first, rename or drop in a later release.
3. **Lists.** Global list endpoints return `{ items, nextCursor }` pages via `packages/projectops/src/pagination.ts`: keyset cursors with an index matching the sort order. Never return an unbounded global list.
4. **Concurrency.** Edits to clients, projects, milestones and tasks send `expectedRevision`; writes to a project's records lock and re-check the parent project in the same statement. New write paths must keep both guarantees and be covered by a PostgreSQL race test.
5. **Time.** Application timestamps come from an injected clock (`ProjectOpsRuntimeConfig.clock` in tests, the wall clock in production). Tests must not depend on the current date.
6. **Security boundary.** Every product route is protected by operator sessions; writes require the configured `Origin`, `application/json` and the session's CSRF token. Stored user text is rendered as text, never HTML (in the React client: never `dangerouslySetInnerHTML`). The client is same-origin: its pages load scripts, styles and fonts only from this server, with no inline code.
7. **Types.** Node strips types without checking them; `tsc` (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`) is the only checker and runs in `pnpm verify`. Keep it at zero errors. Use `import type` for type-only imports, and give `Object.freeze` an explicit type when freezing handlers or tables, or their contents lose type checking.
8. **Errors and logs.** Expected failures throw `HttpError` with a 4xx status and a specific code. Anything else becomes 500 (or 503 when the database is unreachable) with a generic body; the listener logs it with `describeError`. Never put stacks, SQL or internal messages in responses, and never log query strings, request bodies, pg `detail`/`where` or query parameters.
9. **Testing.** Node's built-in `node:test` and `node:assert/strict`. Behavior that touches persistence needs PostgreSQL acceptance coverage, not only memory-executor tests.

## Repository layout

- `apps/api`: HTTP kernel, health and readiness, ProjectOps routes, PostgreSQL runtime (`src/projectops/postgres-app.ts`), entry point `src/projectops/main.ts`
- `apps/client`: React client (Vite); every product page: sign-in, settings, the dashboard, clients and the project workspace (`src/pages/project`, one component per area sharing a workspace context). API response types come from the domain package (`import type`), never hand-copied. `pnpm build` writes `apps/client/dist`, which the server serves
- `apps/web/src/projectops`: the server-rendered delivery summary (`project-handoff.ts`, printable, no script beyond print), and `client-app.ts`, which serves the built client
- `packages/projectops`: domain rules, SQL, repository, migrations, export and dashboard logic; `demo-sandboxes.ts` and `demo-seed.ts` give each demo visitor a private seeded schema (ADR-003). Application SQL must keep naming tables without a schema: sandbox isolation depends on the search_path
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
- Before claiming a change works, run `pnpm verify` (it builds the client), `pnpm test:postgres` and `pnpm test:browser`, and report exactly what ran and what passed. Browser tests find controls by visible label and role; keep those names when moving a page to the client. Never claim deployment or live-provider behavior that was not observed.
- Never commit secrets. Test databases use disposable credentials.
