# Branch Lifecycle Management

- **Node:** `EXEC-CICD-006`

`main` is the canonical long-lived branch for Uruk.

Short-lived branches (`feat/*`, `fix/*`, `docs/*`) are rebased onto `main`, verified, merged, and deleted immediately.
