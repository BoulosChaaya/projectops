# ADR-000: Monorepo Architecture and Raw Platform Primitives

- **Execution Graph Node:** `FOUND-001`
- **Status:** Accepted

## Decision
Use a single `pnpm` workspace with strict package boundaries and raw Node.js/PostgreSQL/Redis primitives rather than ORMs or heavy third-party wrappers.

## Rejected Alternatives
ORMs (Prisma/TypeORM), unvalidated `process.env` access, and third-party logging/auth SDKs.

## Consequences & Enforcement
Eliminates ORM impedance mismatch, supply-chain bloat, and hidden connection/transaction magic.

## Status note (2026-10-14)
The decision stands: ProjectOps uses raw Node.js and PostgreSQL primitives with no ORM, and `pg` is its only runtime dependency (see ADR-001). This record predates the product. Its Redis reference was never implemented in ProjectOps, and the execution-graph node it cites belonged to the removed Uruk foundation docs.
