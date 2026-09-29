# ADR-009: Exponential Backoff and Full Jitter Policy

- **Execution Graph Node:** `EXEC-QUEUE-019`
- **Status:** Accepted

## Decision
Use capped exponential backoff (`baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`) with deterministic full/equal jitter (`EXEC-QUEUE-021`, `022`) for all dependency-bound job retries.

## Rejected Alternatives
Zero-delay immediate retries or unjittered fixed intervals that cause thundering-herd synchronization against recovering downstream services.

## Consequences & Enforcement
`BackoffPolicy` prevents individual job handlers from inventing custom sleep loops.
