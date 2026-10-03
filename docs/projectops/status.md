# ProjectOps current status

## Approved plan
See [roadmap](roadmap.md). The roadmap was approved on 2026-10-03 after the previous conversation was deleted.

## Verified engineering checkpoint
- Repository: BoulosChaaya/projectops; branch: main.
- Product checkpoint: 34707b2a21dd527e8234aaddd003968fb1450b98.
- Latest completed capability: risk workflow.
- GitHub Test run: https://github.com/BoulosChaaya/projectops/actions/runs/37110874426 (success).
- GitHub Build run: https://github.com/BoulosChaaya/projectops/actions/runs/37110874403 (success).
- Build workflow runs pnpm verify (hygiene + native tests); it is not a compiled production build.
- Previous conversation reported local verification 49/49; this recovery review did not rerun it locally.

## Implemented vertical slices
1. Client and project request workflow.
2. Repository-backed persistence contracts and memory executor.
3. Dashboard rendering and web route.
4. Composed application startup with an injected executor.
5. Input validation and error handling.
6. Client and project read APIs.
7. Write invariants and conflict handling.
8. Estimates and approvals.
9. Milestones.
10. Deliverables and acceptance.
11. Invoices and payment recording.
12. Project activity records.
13. Change requests and decisions.
14. Issues and resolution.
15. Feedback and responses.
16. Document links and archiving.
17. Notes and archiving.
18. Tasks and completion.
19. Work logs.
20. Expenses and decisions.
21. Risks and mitigation.

Implemented does not mean complete browser workflow or verified durable storage. The ProjectOps persistence/application tests use the memory executor. The dashboard displays summaries without forms/actions. Access control is not connected to these routes.

## Remaining approved work
Roadmap slices 2-14 remain open. Existing functionality is reused to complete them.

## Next slice
Slice 2: durable application runtime. Establish a PostgreSQL adapter, versioned transactional migration path, configured runnable entry point and database-backed acceptance. Completion requires a fresh database, working API/dashboard and records surviving restart.

## Resume protocol
Read roadmap.md and this file, inspect the current GitHub branch/worktree, and verify the checkpoint before modifying product code. Update this file at each slice with changes, checks, remaining limitations and the next action. Never infer completion from a chat approval alone.

## Durable runtime implementation in progress
Added a pg transport adapter, configured entry point, database readiness check, transactional advisory-locked migrations with a persistent checksum ledger, and PostgreSQL acceptance tests. Local pnpm verify passes 50/50 on Node 24.19.0. The local container cannot switch from root to a PostgreSQL server user; real PostgreSQL 16 acceptance is therefore assigned to GitHub Actions before completion. Operator access remains the next slice. No deployment performed.
