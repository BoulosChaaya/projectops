# ADR-003: Evidence-Driven PostgreSQL Index Selection

- **Execution Graph Node:** `EXEC-DB-052`
- **Status:** Accepted

## Decision
Every non-trivial B-Tree, partial, or composite index must map to an observed query predicate, sort order, or join path and be verified via `EXPLAIN` plan analysis (`EXEC-DB-055`).

## Rejected Alternatives
Speculative indexing on every column, which degrades `INSERT/UPDATE` write amplification and bloats buffer cache.

## Consequences & Enforcement
`IndexSelectionDecision` records target query fingerprint, equality-before-range column ordering (`EXEC-DB-054`), and write maintenance cost (`EXEC-DB-053`).
