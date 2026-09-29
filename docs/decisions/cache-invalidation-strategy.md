# ADR-004: Cache Invalidation Strategy and Source-of-Truth Ownership

- **Execution Graph Node:** `EXEC-CACHE-008`
- **Status:** Accepted

## Decision
PostgreSQL is the sole authoritative source of truth. Cache entries use versioned, namespaced keys (`EXEC-CACHE-004`) combined with explicit post-commit event invalidation (`EXEC-CACHE-010`) and bounded positive TTLs (`EXEC-CACHE-009`).

## Rejected Alternatives
Unbounded TTLs (immortal keys) or treating Redis as primary durable state.

## Consequences & Enforcement
`CacheInvalidationPolicy` maps each resource class to `ttl_only`, `event_invalidated_with_ttl`, or `bypass_cache`.
