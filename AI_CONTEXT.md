# ProjectOps AI Context

ProjectOps is a production-grade client and project operations product built on the Uruk foundation. Treat Uruk as the base layer and ProjectOps as the product being proven on top of it.

The first vertical slice is:

1. Create a client.
2. Create a project request for that client.
3. Move the request through explicit workflow states.
4. Show the request in a dashboard boundary.
5. Persist behavior through raw SQL contracts.
6. Verify the slice with focused tests.

## Technology Invariants

1. **Raw implementation default:** do not add ORMs, framework wrappers, or third-party SDKs without a deliberate decision.
2. **Runtime:** prefer Node.js and Web Platform primitives.
3. **Persistence boundary (`packages/db`):** parameterized raw SQL contracts; no Prisma or ORM layer.
4. **Cache boundary (`packages/cache`):** owned cache abstractions, raw protocol support, explicit fallback behavior.
5. **Queue boundary (`packages/queue`, `apps/worker`):** owned job contracts, retries, idempotency, and durable handoff semantics.
6. **Security (`packages/auth`, `packages/security`):** Node.js `node:crypto`, scoped principals, RBAC, secrets handling, field encryption, and audit integrity.
7. **Observability (`packages/logger`, `packages/observability`):** structured logs, metrics, tracing, privacy redaction, and SLO/error-budget primitives.
8. **Verification (`tests`, `packages/testing-kit`):** Node.js built-in `node:test` and `node:assert/strict`.

## Repository Layout

- `apps/api` — Node.js HTTP kernel and request-serving boundary.
- `apps/worker` — asynchronous worker boundary.
- `apps/web` — server/client rendering and interaction boundary.
- `apps/gateway` — optional gateway boundary for larger systems.
- `packages/config` — environment and runtime configuration.
- `packages/logger` — structured logging and context enrichment.
- `packages/runtime` — lifecycle, draining, faults, supervision, and filesystem boundaries.
- `packages/http-contracts` — shared HTTP, validation, and data-fetching contracts.
- `packages/db` — persistence contracts, transactions, migrations, pooling, and query behavior.
- `packages/cache` — cache keys, invalidation, staleness, stampede protection, and raw protocol support.
- `packages/queue` — jobs, retries, backoff, idempotency, scheduling, and dead-letter behavior.
- `packages/auth` and `packages/security` — authentication, authorization, sessions, secrets, encryption, abuse controls, and audit.
- `packages/observability` — metrics, traces, correlation, privacy, SLOs, and incidents.
- `packages/testing-kit` — unit, integration, contract, migration, and chaos test helpers.
- `packages/release` — provenance, rollout, policy gates, and rollback decisions.
