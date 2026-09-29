# ADR-005: Negative Caching Policy for Not-Found Lookups

- **Execution Graph Node:** `EXEC-CACHE-012`
- **Status:** Accepted

## Decision
Permit short-TTL negative caching (`sentinel: null`, 5–30s TTL) only for high-read public lookup keys subject to cache-penetration attacks, and invalidate immediately upon authoritative creation.

## Rejected Alternatives
Long-lived negative caching that hides newly created records from users.

## Consequences & Enforcement
Negative cache entries use explicit versioned sentinel wrappers (`EXEC-CACHE-006`) and short bounded TTLs.
