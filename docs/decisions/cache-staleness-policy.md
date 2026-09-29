# ADR-006: Stale Data Tolerance Policy per Resource Class

- **Execution Graph Node:** `EXEC-CACHE-013`
- **Status:** Accepted

## Decision
Classify every resource into Tier 0 (`0ms` staleness — auth/permissions/balances bypass cache), Tier 1 (`<= 5s` bounded staleness — domain entities), or Tier 2 (`<= 300s` — public catalog/aggregates).

## Rejected Alternatives
Uniform caching of security-critical or financial state.

## Consequences & Enforcement
`StalenessPolicy` (`maxStalenessFor(resource)`) enforces machine-readable staleness bounds (`EXEC-CACHE-014`).
