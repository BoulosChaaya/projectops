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
Roadmap slices 1-9 are complete and verified. Slice 9 is on its dedicated review branch; it has not been merged into main. Slices 10-14 remain open. Existing functionality is reused to complete them.

## Next slice
Slice 10: finances, after independent review of Slice 9. Slice 10 has not begun. The runnable application defaults to loopback and is not deployed.

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

## Completed slice 7: planning
- Protected workspace forms create, edit, reschedule, complete and reopen tasks and milestones. Optional dates and task description/assignee fields can be cleared; records remain visible when the project is read-only; stored user text is rendered safely.
- Milestone creation/editing/reopening is limited to approved/in-progress projects; completion is also allowed on held/delivered projects. Task commands are allowed for estimated, approved, in-progress, held and delivered projects. Child status rules require open records for edit/complete and completed records for reopen.
- Additive migration 0006 gives tasks and milestones positive integer revisions, defaulting existing records to revision 1. Edit, complete and reopen increment the child revision without incrementing the project revision.
- Child SQL writes conditionally check identity, revision and child status while locking/checking the parent project in the same statement. This prevents a child write from committing after cancellation/archive wins the parent-row serialization race.
- New PUT edit and POST reopen routes follow the existing protected route boundary. Browser completion sends the expected child revision; compatible older completion calls still derive a revision before issuing the same guarded SQL write.
- Implementation checkpoint: 4b13645460b8733e02c35aa33fdd5763288284c1.
- `pnpm verify`: 63/63 PASS; hygiene passed for 567 files.
- `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres`: 13/13 PASS, zero skips.
- `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser`: 5/5 PASS, zero skips. The pre-identified duplicate `Client not found.` locator was scoped to `#client-status`; no client-management behavior changed.
- PostgreSQL acceptance verifies fresh and pre-0006 migration, existing-row revision initialization, full planning persistence across restart, optional-field clearing, state restrictions and deterministic failures. Controlled races prove one winner for competing edits and edit-versus-complete, stale command rejection, cancellation winning against task/milestone mutations with unchanged children, and the reverse order where a child commits before cancellation.
- Chromium acceptance verifies creation, validation, safe text, edit/reschedule/clear, completion/reopen, reload persistence, stale-tab conflict feedback and held/cancelled read-only behavior.
- Limitations: execution workspace editing remains slice 8, delivery acceptance/completion gates remain slice 9, currency-separated totals remain slice 10, and automatic history remains slice 11. No deployment claim.

## Completed slice 8: execution workspace
- Protected workspace forms create work logs, notes, document links, issues and risks. Notes and document links can be archived, issues resolved and risks mitigated. Work logs remain immutable; no edit, reopen, unarchive, delete or file-upload commands were introduced.
- Work logs can relate to an existing task and document links to an existing deliverable. Browser writes take actor, author, uploader and action identities from the signed-in operator and use server timestamps. Stored text is rendered safely and document links are restricted to HTTP(S).
- Work-log creation is allowed for estimated, approved, in-progress and delivered projects. Issue, risk and document creation is also allowed while held. Notes can be created in every nonterminal state. Resolution, mitigation and archival actions are allowed in every nonterminal state. Cancelled/archived parents reject all execution writes while retaining readable records.
- All nine execution write paths lock and validate the parent row in the same PostgreSQL statement. Creates use a guarded insert; terminal actions additionally require the child identity and expected open/active state. Parent revisions are unchanged, and no schema migration or child revision was added.
- Zero-row guarded writes are classified after the atomic decision: genuinely missing parents, children, tasks or deliverables return 404; existing resources invalidated by parent state, child state, duplicate identity or a concurrent lifecycle change return 409.
- Implementation checkpoint: 38358659da73a1bb9bdfd9bc77721e86de2e1934.
- `pnpm verify`: 66/66 PASS; hygiene passed for 571 files; zero skips.
- `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres`: 15/15 PASS, zero skips.
- `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser`: 6/6 PASS, zero skips.
- PostgreSQL acceptance verifies persistence across restart, defaults and optional relationships, terminal metadata, the complete parent-state matrix, unchanged rows on failures, missing-resource and duplicate classification, and memory-executor parity. Controlled races prove one winner for every terminal action; cancellation winning against each create/action leaves children absent/unchanged; hold winning blocks a work log while continuing to permit the other resources; child-first serialization may commit before cancellation; archive-first serialization blocks later writes.
- Chromium acceptance verifies all five resources, relationships, terminal actions and metadata, reload persistence, validation, stale conflict/reload feedback, new/held/cancelled/archived controls, retained read-only records, safe text and link rendering, independent retry and no unexpected page errors.
- Limitations: delivery acceptance/completion gates remain slice 9, currency-separated totals remain slice 10, and automatic history remains slice 11. The execution slice does not add editing or reversal commands. No deployment claim.

## Completed slice 9: delivery and acceptance
- Protected workspace submission and acceptance of deliverables, feedback creation and addressing, and project delivery/archival readiness. Optional milestone/deliverable selections stay within the same project. Existing open milestones are valid deliverable relationships.
- Deliverable submission is allowed only while approved/in progress. Acceptance is allowed while approved/in progress/on hold/delivered, and conditionally transitions submitted → accepted. Feedback creation/addressing is allowed while estimated/approved/in progress/on hold/delivered, with addressing conditionally transitioning open → addressed. New/cancelled/archived parents reject the corresponding commands; terminal records remain readable.
- Feedback author is editable source attribution; it is not replaced with the operator. The protected API derives addressedBy from the authenticated session and all submission/acceptance/feedback/action timestamps from the server. No acceptedBy, child revisions, new fields, migrations, editing or reversal commands were added.
- Approved delivery predicate: at least one deliverable exists, every deliverable is accepted, and no feedback remains open. No other collection is a prerequisite. Both /control and compatibility /status enforce it for in_progress → delivered and re-evaluate it for delivered → archived. Cancelled → archived bypasses delivery readiness.
- Delivery and archival lease one PostgreSQL connection, begin a READ COMMITTED transaction, lock/validate the project and expected revision, read readiness after the lock, and conditionally update the project before committing. All four delivery-resource writes guard the parent with the same row lock; terminal actions additionally require the identified submitted/open child. Child writes never increment project revisions. Successful project transitions increment them once.
- Guard failures preserve deterministic 400 validation, 404 genuinely missing parent/child/relationship, and 409 state/duplicate/stale/readiness responses. Follow-up reads classify zero-row failures only; they do not authorize the write. Memory execution mirrors the business rules and transaction behavior; PostgreSQL proves serialization.
- The isolated project-delivery.ts component replaces generic deliverable/feedback views with forms and one-way actions. It displays readiness, field validation/missing/conflict feedback, deliberate conflict reload, independent section retries, state-aware controls, retained read-only records, safe text and restricted HTTP(S) links. Audit timestamps are not editable.
- Branch: slice-9-delivery-acceptance, based on accepted main checkpoint 7c006c38f45820d9246c03e68e9865837538115a. Implementation checkpoint: f0052156c5b0fc5c805538023656a8e60b8357c7. Documentation is recorded in the following commit on the same branch. Independent PR review is required; no merge has been performed.
- `pnpm verify`: 72/72 PASS; hygiene passed for 575 files; zero skips.
- `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres`: 19/19 PASS; zero skips.
- `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser`: 7/7 PASS; zero skips, including the complete protected delivery journey.
- Verified locally on Node 24.19.0, pnpm 11.19.0, PostgreSQL 16.15 and Playwright Chromium 153.0.8010.12. Dependencies/lockfile were unchanged. Runtime reproduction details are in runtime.md.
- Controlled PostgreSQL evidence: shared child-read barriers produce exactly one acceptance/addressing winner; cancellation and cancellation-followed-by-archival winning leave each child absent/unchanged; hold/delivery winning prevent later submission; child-first submission/open feedback block delivery; acceptance/addressing first can enable delivery; delivery first still permits feedback; delivered archival versus new feedback serializes correctly in both orders; delivery versus cancellation preserves the existing project revision winner rule.
- Native/database acceptance also proves the full parent-state matrix, validation, defaults, optional same-project relationships, duplicate/constraint classification, missing resources, unchanged failed writes, retained terminal metadata, restart persistence, delivered archival readiness and cancelled archival bypass. Chromium proves stale terminal commands, all sentiments/source attribution, optional response notes, operator addressing, validation/missing relationships, unsafe URL rejection, safe rendering, state controls, persistence/reload and independent retries with no page errors.
- Completion gate satisfied. No failed or skipped final acceptance tests and no database/browser environment blockers. Earlier test failures were corrected and affected suites rerun. Limits: no production deployment, client portal, uploads, deliverable/feedback editing/reversal/versioning or automatic history. Finances remain Slice 10; Slice 10 has not begun.
