# ADR-008: Asynchronous Job Retry Ownership and At-Least-Once Semantics

- **Execution Graph Node:** `EXEC-QUEUE-016`
- **Status:** Accepted

## Decision
repository-owned queue workers provide at-least-once delivery (`EXEC-QUEUE-002`). Only failures classified as `transient` (`EXEC-QUEUE-014`) are retried up to a finite per-job-class limit (`EXEC-QUEUE-017`); permanent/validation errors transition directly to Dead-Letter Isolation (`EXEC-QUEUE-023`).

## Rejected Alternatives
Infinite retries, retrying programmer/validation errors, or claiming exactly-once execution without idempotency keys (`EXEC-QUEUE-026`).

## Consequences & Enforcement
`RetryPolicy` centralizes max attempts and retry eligibility.
