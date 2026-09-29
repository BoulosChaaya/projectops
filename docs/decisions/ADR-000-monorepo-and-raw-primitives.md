# ADR-000: Monorepo Architecture and Raw Platform Primitives

- **Execution Graph Node:** `FOUND-001`
- **Status:** Accepted

## Decision
Use a single `pnpm` workspace with strict package boundaries and raw Node.js/PostgreSQL/Redis primitives rather than ORMs or heavy third-party wrappers.

## Rejected Alternatives
ORMs (Prisma/TypeORM), unvalidated `process.env` access, and third-party logging/auth SDKs.

## Consequences & Enforcement
Eliminates ORM impedance mismatch, supply-chain bloat, and hidden connection/transaction magic.
