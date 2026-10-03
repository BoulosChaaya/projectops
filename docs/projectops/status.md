# ProjectOps current status

## Approved plan
See [roadmap](roadmap.md). The roadmap was approved on 2026-10-03 after the previous conversation was deleted.

## Recovery baseline checkpoint
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
Roadmap slices 1-6 are complete. Slices 7-14 remain open. Existing functionality is reused to complete them.

## Next slice
Slice 7: planning. Implement browser create/edit/reschedule/complete/reopen tasks and milestones, with persistence, validation and atomic child-command state/concurrency checks. The runnable application defaults to loopback and is not deployed.

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

## Completed slice 3: operator access and settings
- Database-backed operator, hashed sessions, expiry, login limits and settings in additive migration 0002.
- Login/settings browser pages; logout, current-password credential changes and revocation.
- Protected product routes with Origin, JSON and CSRF checks for writes; fixed HTTPS public origin for external binding.
- Saved priority/currency defaults applied to new requests/estimates when omitted; timezone retained for later display.
- Operator provisioning is a local stdin command; one operator, no public signup or team model.
- Implementation checkpoint: 24e46c0091c098f498bece3ea1c69d99827ba896; PR https://github.com/BoulosChaaya/projectops/pull/2.
- Local pnpm verify: 52/52 PASS.
- PostgreSQL acceptance: 6/6 PASS, zero skips; Chromium browser journey: 1/1 PASS in https://github.com/BoulosChaaya/projectops/actions/runs/37117409254.
- Browser acceptance verifies invalid credentials, sign-in, saved defaults after reload, credential change, re-login, logout and protected-page redirects.
- Final follow-up preserves the configured loopback hostname for browser Origin matching and checks localhost in the native access test.
- Limitations: no deployment; timezone display, mixed-currency totals and remaining product browser workflows are assigned to later slices.

## Completed slice 4: client management
- Browser directory and client detail page: create, search/status filters, view, edit and confirm archive, with projects per client.
- Empty, missing-client, validation and stale-revision states; deliberate reload preserves concurrency decisions.
- Additive migration 0003 initializes client revisions; conditional writes reject stale edits/archives.
- Archived clients retain history and are read-only; new project creation checks and locks the client row.
- Implementation checkpoint: e930ae8d9078b6be8a55211681c65fcca73bb6cb; PR https://github.com/BoulosChaaya/projectops/pull/3.
- Local pnpm verify: 55/55 PASS.
- Real PostgreSQL acceptance: 8/8 PASS; Chromium journeys: 2/2 PASS; zero skips in https://github.com/BoulosChaaya/projectops/actions/runs/37118540541.
- Database acceptance verifies upgrading the prior schema, concurrent edits, literal search, clearing contact fields, restart persistence, archive/history retention, and an insert blocked by a concurrent archive.
- Browser acceptance verifies protected client pages, creation, safe text rendering, project history, edits, stale-tab conflict/reload, archive confirmation/cancel, filters/search, empty and missing-client states.
- Limitations: project workspace links/editing are slice 5; client restore/delete are not introduced. No deployment claim.

## Completed slice 5: project workspace and editing
- Project creation on active client pages and navigation from client/dashboard project names.
- Protected workspace with overview, estimate/approval and all thirteen existing collection sections; independent failure/retry states.
- Detail edits for title, brief, budget range, priority and deadline, with clearing optional fields and stale revision feedback/reload.
- Additive migration 0004; revisions include estimate, approval and status writes. Archived projects remain read-only.
- Dates display in saved operator timezone; deadline inputs explicitly use UTC. Existing budget range transport mapping corrected.
- Implementation checkpoint: bac478de02f65f267e1c502400379789e98e5372; PR https://github.com/BoulosChaaya/projectops/pull/4.
- Local pnpm verify: 57/57 PASS.
- PostgreSQL acceptance: 9/9 PASS; Chromium journeys: 3/3 PASS; zero skips in https://github.com/BoulosChaaya/projectops/actions/runs/37119697206.
- Database acceptance verifies migration from the prior schema, budget/deadline transport, concurrent edit rejection, stale edits after estimate/approval changes, metadata preservation, clearing fields and restart persistence.
- Chromium verifies project creation with saved defaults, navigation from client/dashboard, all collection views, safe stored text and links, independent retry, timezone display, detail edits, stale-tab reload, optional-field clearing, archived read-only views and missing-project feedback.
- Limitations: controls and workflow/concurrency defects are slice 6; collection editing and automatic history remain their later slices. No deployment claim.

## Completed slice 6: estimates and project controls
- Browser save/revise estimate, approve, start, hold, resume, cancel, deliver and archive controls, with confirmation/dismissal and stale-tab reload feedback.
- Integer-cent decimal input, saved currency default, signed-in operator approval, and estimate revisions only until approval.
- Explicit estimate/approval commands record required metadata; generic status writes cannot bypass them. Starting, holding, resuming and delivering require estimate/approval metadata.
- Parent edits/estimate/approval/lifecycle writes use conditional revision/state checks; competing decisions cannot overwrite each other.
- Additive migration 0005 supports held/cancelled states. Hold survives restart and blocks delivery/new work logs. Cancelled projects leave the active dashboard, retain client/history views and become read-only; archive retains records.
- Implementation checkpoint: 3f934cad2361302aa7069596bcfde73772f8b7e8; PR https://github.com/BoulosChaaya/projectops/pull/5.
- Local pnpm verify: 60/60 PASS.
- PostgreSQL acceptance: 11/11 PASS; Chromium journeys: 4/4 PASS; zero skips in https://github.com/BoulosChaaya/projectops/actions/runs/37121482284.
- Database acceptance verifies migration from the prior schema, stale revisions, estimate/approval and cancellation/delivery races, hold across restart, terminal write rejection and record retention. A shared-snapshot barrier ensures both competing commands read the same state before writing, proving the SQL guard itself rejects one decision.
- Chromium verifies currency defaults and exact decimal conversion, estimate revision, stale-tab approval rejection/reload, confirmation dismissal, estimate-to-archive lifecycle, hold/resume, cancellation, dashboard removal and retained client history.
- Limitations: atomic child-command guards (including writes racing cancellation) remain in slices 7-10; delivery acceptance/completion gates remain slice 9, currency-separated totals slice 10, and automatic history slice 11. No deployment claim.
