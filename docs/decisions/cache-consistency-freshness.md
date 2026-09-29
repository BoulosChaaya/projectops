# ADR-007: Consistency vs. Freshness Trade-off During Cache Disagreement

- **Execution Graph Node:** `EXEC-CACHE-015`
- **Status:** Accepted

## Decision
Fail-closed to authoritative PostgreSQL for Tier 0/1 resources when cache version mismatches, and degrade gracefully to PostgreSQL (or bounded read-through) if Redis is unreachable.

## Rejected Alternatives
Serving unverified stale data for mutations or authorization checks during Redis partitions.

## Consequences & Enforcement
`FreshnessConsistencyPolicy` governs fallback behavior per resource class.
