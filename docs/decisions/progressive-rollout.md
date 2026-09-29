# ADR-013: Progressive Rollout and Health-Gated Traffic Shifting

- **Execution Graph Node:** `EXEC-CICD-031`
- **Status:** Accepted

## Decision
Support staged reverse-proxy traffic shifting (e.g., 10% -> 50% -> 100%) across immutable container revisions with bounded observation windows (`EXEC-CICD-032`, `033`), falling back to blue/green atomic cutover on single-node deployments.

## Rejected Alternatives
In-place mutable code patching on live servers.

## Consequences & Enforcement
`ProgressiveRolloutDecision` ties traffic promotion to live readiness and SLO error-budget health.
