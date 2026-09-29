# ADR-002: Zero-Downtime Expand/Migrate/Contract Schema Evolution

- **Execution Graph Node:** `EXEC-DB-046`
- **Status:** Accepted

## Decision
Enforce a 3-phase Expand -> Migrate/Backfill -> Contract protocol for all production PostgreSQL schema changes so version N and N+1 application instances can coexist safely (`EXEC-DB-047`).

## Rejected Alternatives
Destructive single-step `ALTER TABLE DROP/RENAME COLUMN` during live traffic or automatic down-migrations in production.

## Consequences & Enforcement
`ZeroDowntimeMigrationPlan` requires additive nullable/default columns first, dual-read/write compatibility, and contract removal only after rollout verification.
