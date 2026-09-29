# ADR-014: Pre-Deployment Rollback Feasibility Classification

- **Execution Graph Node:** `EXEC-CICD-034`
- **Status:** Accepted

## Decision
Classify every release before deployment across three dimensions—Application Artifact (`reversible`), Database Schema (`expand_only_reversible` vs `irreversible`), and External Side Effects—blocking automated rollback when schema/data changes require forward-recovery.

## Rejected Alternatives
Blindly rolling back application containers against an incompatible mutated database schema.

## Consequences & Enforcement
`classifyRollbackFeasibility()` gates `Automated Rollback on Failure Signal` (`EXEC-CICD-035`).
