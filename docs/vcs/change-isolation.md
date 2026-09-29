# Change Isolation Policy

- **Node:** `EXEC-CICD-005`

All feature and capability work occurs on isolated branches and cannot enter `main` without passing `scripts/verify-integrity.mjs`.
