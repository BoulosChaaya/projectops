# ProjectOps current status

## Approved plan
See [roadmap](roadmap.md). The roadmap was approved on 2026-10-03 after the previous conversation was deleted.

## Verified engineering checkpoint
- Repository: BoulosChaaya/projectops; branch: main.
- Product checkpoint: 34707b2a21dd527e8234aaddd003968fb1450b98.
- Latest completed capability at the recovery checkpoint: risk workflow.
- GitHub Test run: https://github.com/BoulosChaaya/projectops/actions/runs/37110874426 (success).
- GitHub Build run: https://github.com/BoulosChaaya/projectops/actions/runs/37110874403 (success).
- Build workflow runs pnpm verify (hygiene + native tests); it is not a compiled production build.
- Recovery baseline was rerun locally: pnpm verify passed 49/49 before runtime changes.

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

Implemented does not mean complete browser workflow. The original contract/application tests use the memory executor; the durable-runtime acceptance added below verifies real PostgreSQL separately. The dashboard displays summaries without forms/actions. The PostgreSQL runtime now protects these routes; contract tests may still inject an unprotected memory harness.

## Remaining approved work
Roadmap slices 1 and 2 are complete. Slices 3-14 remain open. Existing functionality is reused to complete them.

## Next slice
Slice 3: operator access and settings. Integrate login/logout, protected pages/APIs, credential management and application defaults. The runnable application currently defaults to loopback and is not deployed.

## Resume protocol
Read roadmap.md and this file, inspect the current GitHub branch/worktree, and verify the checkpoint before modifying product code. Update this file at each slice with changes, checks, remaining limitations and the next action. Never infer completion from a chat approval alone.

## Completed slice 2: durable application runtime
- Implementation checkpoint: 83637607732d247a3c2e01f979279793c3cfd8e3; PR https://github.com/BoulosChaaya/projectops/pull/1.
- Added pg transport pool, configured start command, database readiness and graceful shutdown.
- Added frozen SQL artifact loading, transactional advisory-locked migrations, persistent checksum ledger, upgrade/drift checks and legacy-schema refusal.
- Local pnpm verify: 50/50 PASS on Node 24.19.0.
- PostgreSQL acceptance: 4/4 PASS, zero skips, on PostgreSQL 16.15 and Node 22.23.3 in https://github.com/BoulosChaaya/projectops/actions/runs/37115086468.
- Acceptance proves fresh migrations, API/dashboard data across application restart, concurrent migration startup, upgrades, drift rejection and schema/ledger rollback.
- All CI entry points now install pinned dependencies from the frozen lockfile before testing.
- Limitation: local container blocks changing to the non-root PostgreSQL server user; real database evidence comes from CI. No production deployment or operator access claim.

## Slice 3 implementation: operator access and settings
- Database-backed operator, hashed sessions, expiry, login limits and settings in additive migration 0002.
- Login/settings browser pages; logout, current-password credential changes and revocation.
- Protected product routes with Origin, JSON and CSRF checks for writes; fixed HTTPS public origin for external binding.
- Saved priority/currency defaults applied to new requests/estimates when omitted; timezone retained for later display.
- Operator provisioning is a local stdin command; one operator, no public signup or team model.
- Validation pending real PostgreSQL and Chromium CI acceptance. Do not mark complete until those pass.
