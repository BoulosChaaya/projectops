# ADR-012: Version Control Change Reconciliation and Conflict Resolution

- **Execution Graph Node:** `EXEC-CICD-010`
- **Status:** Accepted

## Decision
Require explicit rebase/merge reconciliation with zero unresolved Git index markers (`EXEC-CICD-009`), mandatory human semantic review on conflict resolution, and a clean post-reconciliation verification gate (`EXEC-CICD-024`).

## Rejected Alternatives
Automated merge-ours/theirs heuristics or merging conflicted branches without re-running the full verification gate.

## Consequences & Enforcement
`ConflictResolutionDecision` blocks builds when conflict markers or unverified merges exist.
