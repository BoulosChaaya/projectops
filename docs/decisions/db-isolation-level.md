# ADR-001: PostgreSQL Transaction Isolation Level Selection

- **Execution Graph Node:** `EXEC-DB-033`
- **Status:** Accepted

## Decision
Default to `READ COMMITTED` for standard CRUD/write operations with explicit optimistic/pessimistic locking (`EXEC-DB-035`, `036`), and require `REPEATABLE READ` or `SERIALIZABLE` for financial/ledger and invariant-spanning transactions.

## Rejected Alternatives
`READ UNCOMMITTED` (prohibited) and global `SERIALIZABLE` on all routes (excessive serialization retry overhead on simple reads).

## Consequences & Enforcement
`IsolationLevel` (`'read_committed' | 'repeatable_read' | 'serializable'`) is enforced at `withTransaction` (`EXEC-DB-031`).
