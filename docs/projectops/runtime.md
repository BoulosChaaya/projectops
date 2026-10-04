# Running ProjectOps with PostgreSQL

Requires Node 22.6+ (Node 22 recommended), pnpm and PostgreSQL 16+. The runtime protects ProjectOps pages and APIs with operator sessions. It is not yet deployed.

```bash
pnpm install --frozen-lockfile
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/projectops'
pnpm operator:create < operator.json
pnpm start
```

Keep actual credentials outside git. Configure PostgreSQL TLS through the connection URL; certificate verification is not disabled by application code. HOST defaults to 127.0.0.1 and PORT to 3000. The database must already exist. Provision once using a private JSON input file with `login` and `password` fields, a password of at least 12 characters, and file permissions 0600. Keep the file outside the repository and delete it after provisioning. The command never overwrites an existing operator. Open /projectops/login to sign in, /projectops for the summary dashboard, and /projectops/settings to change credentials or defaults; API routes are under /projectops. SIGINT/SIGTERM close the HTTP server and database pool.

Startup applies the frozen migration artifacts in a transaction and records their names/checksums in projectops_schema_migrations. Concurrent startup is serialized. Subsequent startup verifies and skips applied versions. Do not edit an applied artifact; add and register the next version. Startup refuses existing ProjectOps tables without a ledger: back up and prepare an explicit legacy migration before using such a database.

## Verification

```bash
pnpm verify
export PROJECTOPS_TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/projectops_test'
pnpm test:postgres
pnpm test:browser
```

The PostgreSQL acceptance command fails if its URL is missing. It creates unique test schemas and removes only those schemas afterward. Use a dedicated test database and a role allowed to create schemas. It checks API writes and dashboard reads across application restart, simultaneous migration startup, a new migration version, checksum drift, transactional rollback and unmanaged-schema refusal. GitHub Actions runs it against PostgreSQL 16.

## Operator access

The current boundary has one operator identity, matching the operator access slice. No public registration or team account model is introduced. Passwords use the foundation's salted scrypt hashing. Opaque sessions store only a SHA-256 token hash in PostgreSQL, expire after eight hours or thirty minutes idle, and survive application restart. Logout revokes the current session; changing credentials requires the current password and revokes every session. Login and credential verification share a persistent limit of ten attempts per minute. Account recovery and team permissions are not implemented by this slice.

For external access, set PUBLIC_ORIGIN to the exact HTTPS origin (for example https://projectops.example.com), terminate TLS at your trusted proxy, and configure HOST appropriately. Forwarded headers never select the origin. Non-loopback binding without HTTPS PUBLIC_ORIGIN is rejected. HTTP cookies are allowed only for loopback development; external sessions use a Secure, HttpOnly, SameSite=Strict host cookie. Every write requires the configured Origin, application/json, and the session's x-csrf-token header. Login requires Origin and JSON as well. Obtain the CSRF token from GET /projectops/access/session after login; never store the session token in browser local storage.

Settings persist currency, priority and an IANA timezone. New project requests use the saved priority when omitted; estimates use the saved currency when omitted. Explicit values still win and are validated. Timezone is retained for later workspace display; existing stored timestamps remain ISO UTC. Finance totals use actual record currencies independently of settings or project estimate currency; see the completed finances workflow below.

Browser acceptance runs a real Chromium journey against PostgreSQL:

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:browser
```

Real database acceptance also checks upgrading the previous schema without losing client records, hashed credential/session storage, persisted settings and sessions, session expiry, revocation, credential changes, and persistent rate limits. The application factory without access is a contract-test harness; the PostgreSQL runtime always enables access.

## Client management

Open /projectops/client-management from the dashboard to create and search clients by name, contact or email. The directory defaults to active clients and can show archived or all clients. Each client page shows contact details and that client's projects. Project links open the workspace; active clients also provide a project creation form.

Active clients can be edited or archived after confirmation. Archiving retains existing project records and contact information, makes the client read-only, and prevents new project intake. Existing projects can continue their own workflows. No client deletion or restore action is introduced.

The client API provides GET /projectops/clients?q=...&status=active|archived|all (default all), PUT /projectops/clients/:id for full contact-field replacement, POST /projectops/clients/:id/archive, and GET /projectops/clients/:id/projects. Edits and archives require expectedRevision from the current client response. A stale revision or archived client returns 409; the browser offers a deliberate reload. Empty optional contact/email fields clear them. Search treats SQL wildcard characters literally and is case-insensitive.

Migration 0003 adds client revisions without changing existing records. Conditional SQL updates prevent lost edits. Project insertion locks and checks the client row, so a concurrent archive cannot be bypassed. Native, PostgreSQL and Chromium checks run through the existing verification commands.

## Project workspace and editing

Create projects from an active client page. Creation uses the saved priority and accepts a title, brief, budget range and optional deadline. Dashboard project names and client project lists link to /projectops/projects/:id.

The workspace displays overview/estimate/approval details and all existing collections: milestones, tasks, work logs, notes, documents, issues, risks, deliverables, feedback, invoices, expenses, change requests and recorded history. Section links navigate the page; failed collection reads offer an independent retry. Stored text is rendered as text, and document/artifact links are restricted to HTTP(S) with no opener/referrer. Amounts show the record's own currency, without introducing cross-currency totals.

PUT /projectops/project-requests/:id updates title, brief, budgetRange, priority and deadlineIso using expectedRevision. Optional budget/deadline fields can be cleared. Identity, client, creation date, workflow state, estimate and approval metadata are preserved. Cancelled and archived projects are read-only. Migration 0004 initializes revisions; project edits and estimate/approval/control writes increment them, so a stale editor also detects workflow changes. Parent estimate, approval and status writes check the expected revision and current state atomically.

Deadline inputs explicitly use UTC; displayed dates use the operator's saved IANA timezone. API deadlines remain ISO instants and cannot precede project creation. Forms reject invalid input and offer a deliberate reload on 409 conflicts. Planning, execution and delivery controls are described below. Finance commands and automatic history are completed in Slices 10 and 11 as described below.

## Estimates and project controls

The workspace lets the operator save or revise an estimate while the project is new/estimated, then approve it. Amount input is in currency units with up to two decimal places; transport and storage use integer cents. The currency starts from saved settings. Approval records the signed-in operator in the browser. Estimates are fixed after approval.

Available actions follow the project state: approved → start; in progress → hold, deliver or cancel; on hold → resume or cancel; new/estimated/approved → cancel; delivered/cancelled → archive. Approval, lifecycle and archive actions require a browser confirmation; dismissing it makes no change. Held projects cannot record new work logs or be delivered. Cancelled projects disappear from the active dashboard but remain linked in client history with their existing records.

POST /projectops/project-requests/:id/control accepts action (start, hold, resume, cancel, deliver, archive) and expectedRevision. Estimate and approval commands accept expectedRevision; browser requests always send it. The older status/estimate/approval API payloads may omit a revision for compatibility, but the repository still checks the revision/state read by that command when writing. Stale commands return 409 and the browser offers Reload project. Generic status writes cannot create estimated/approved states; use the explicit commands that record their metadata. Starting, holding, resuming and delivering require recorded estimate/approval metadata.

Migration 0005 adds on_hold/cancelled to the status constraint without rewriting existing records. Legacy estimated records missing an estimate can be estimated again; legacy approved records missing required metadata cannot start and can be cancelled/archived. Child routes reject ordinary writes to cancelled/archived projects. Planning, execution and delivery commands now enforce their atomic parent guards as described below. Finance child guards/currency-separated totals and automatic history are described in the completed Slice 10 and 11 sections below.

## Planning

The Milestones and Tasks workspace sections provide browser creation, editing, due-date changes and clearing, completion and reopening. Milestone edits change only title and optional due date. Task edits change title, optional description, optional assignee, priority and optional due date. Empty optional fields clear their stored values. Completion metadata is set by completion and cleared by reopening; identity, parent, creation time and status/completion metadata are not directly editable. Stored text is inserted through text-only DOM APIs.

Milestones can be created and edited while the project is approved or in progress. An open milestone can be completed while the project is approved, in progress, on hold or delivered; a completed milestone can be reopened only while approved or in progress. Task creation, editing, completion and reopening are available while the project is estimated, approved, in progress, on hold or delivered. Edits require an open child; completion changes open to completed; reopening changes completed to open. New, cancelled and archived states reject task commands, and cancelled/archived states reject every milestone command. Read-only project states retain their planning records in the workspace.

The collection GET/POST and completion routes remain available. Planning also provides:

```text
PUT  /projectops/project-requests/:id/milestones/:milestoneId
POST /projectops/project-requests/:id/milestones/:milestoneId/reopen
PUT  /projectops/project-requests/:id/tasks/:taskId
POST /projectops/project-requests/:id/tasks/:taskId/reopen
```

Migration 0006 adds `revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)` to both child tables, so upgraded records start at revision 1. New records also start at 1. Edit, complete and reopen atomically compare and increment the child revision; browser commands send the displayed revision and expose a deliberate reload after a 409 conflict. Compatibility completion callers that omit a revision still use the revision read by that command, and the SQL guard remains conditional.

Every planning insert/update locks and validates the parent project row in the same SQL statement. Updates also compare child identity, revision and required child status. If cancellation/archive obtains the parent lock first, the waiting child command conflicts and leaves the child unchanged; if the child commits first, the later lifecycle command may proceed. Planning changes do not increment the project revision. Native, real PostgreSQL and Chromium coverage runs through the verification commands above.

## Execution workspace

The Work logs, Notes, Documents, Issues and Risks sections are managed directly from the protected project workspace. Work logs accept an optional existing task relationship and remain immutable. Document links accept an optional existing deliverable relationship. Notes and documents can be archived, issues resolved with an optional resolution note, and risks mitigated with an optional mitigation note. These one-way actions cannot be repeated. Records remain visible after their terminal action and after project cancellation or archival.

The browser derives actor, author, uploader and action identities from the authenticated operator; clients cannot submit another audit identity or audit timestamp. Server timestamps record creation and terminal actions. Stored text uses text-only DOM rendering, and document URLs are exposed only when they use HTTP(S), with opener/referrer protection.

Parent-state rules are resource-specific. Work logs can be created for estimated, approved, in-progress and delivered projects. Issues, risks and documents can also be created while on hold. Notes can be created in every state except cancelled/archived. Issue resolution, risk mitigation and note/document archival are allowed in every nonterminal state. New projects therefore allow notes and terminal actions on existing children, while held projects block only new work logs. Cancelled and archived projects retain all records but reject every execution write with a conflict.

The existing collection and action routes are unchanged. Their authentication, authorization, Origin, JSON and CSRF boundaries continue to apply. Invalid payloads return 400. Missing parents, children, related tasks or related deliverables return 404. Existing rows whose parent state, child state, duplicate identity or concurrent lifecycle transition invalidates the command return 409; the browser provides reload/retry feedback for conflicts.

Each of the five creates uses an insert guarded by a locked parent row and its permitted states. Each of the four terminal actions locks/checks the parent and conditionally updates only the identified open/active child. A cancellation/archive or hold transition that locks the parent first can prevent the corresponding execution write without leaving a partial child change; a child write that commits first may precede the lifecycle transition. Concurrent terminal actions have exactly one winner. Execution writes do not increment the project revision. The existing schema supports this contract, so Slice 8 adds no migration or child revision column.

Slice 8 implementation checkpoint `38358659da73a1bb9bdfd9bc77721e86de2e1934` passed `pnpm verify` with 66/66 tests and 571-file hygiene, `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres` with 15/15 tests, and `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser` with 6/6 tests; all three had zero skips. The execution workspace does not add edit, reopen, unarchive, delete or file-upload commands. Slice 9 adds the delivery and completion gates described below. Finances remain Slice 10 and automatic history remains Slice 11. The runtime still defaults to loopback and is not deployed.

## Delivery and acceptance

The protected project workspace provides deliverable submission and acceptance, and feedback creation and addressing in an isolated delivery component. Submission accepts a title, HTTP(S) artifact URL and optional existing milestone from the same project; the milestone need not be completed. Feedback accepts source author, positive/neutral/negative sentiment (default neutral), message and an optional existing deliverable from the same project. Addressing accepts an optional response note. Accepted/addressed records and terminal metadata remain visible after project delivery, cancellation or archival. Forms and actions follow the approved parent-state rules:

| Command | Permitted project states | Child transition |
| --- | --- | --- |
| Submit deliverable | approved, in_progress | new record → submitted |
| Accept deliverable | approved, in_progress, on_hold, delivered | submitted → accepted |
| Create feedback | estimated, approved, in_progress, on_hold, delivered | new record → open |
| Address feedback | estimated, approved, in_progress, on_hold, delivered | open → addressed |

All other parent states reject that command. Repeating acceptance/addressing conflicts. Read-only states retain all records. Browser validation and server 400/404/409 errors appear in the relevant section, with deliberate reload after conflicts and independent retry after collection-read failures. User text is rendered through text-only DOM APIs; artifact links require HTTP(S), forbid embedded credentials, and carry opener/referrer protection. The database and API reject non-HTTP(S) artifact URLs. Source author remains source attribution; protected addressing always uses the signed-in operator. Protected API audit timestamps always use the server clock even if a caller supplies another timestamp. The unprotected contract-test harness retains its existing explicit timestamp/actor inputs. No audit timestamp is editable in the browser and no acceptedBy was introduced.

Delivery requires **at least one deliverable, every deliverable accepted, and no open feedback**. This is the only completion predicate; tasks, milestones and execution/finance records do not participate. Both existing project status and control routes apply it before in_progress → delivered and again before delivered → archived. Feedback can still be recorded/addressed after delivery, so open post-delivery feedback blocks archival. Cancelled → archived keeps the existing behavior without delivery prerequisites. The browser displays the readiness condition and current counts, while the server remains authoritative and returns `409 PROJECTOPS_DELIVERY_NOT_READY` if readiness fails.

The existing collection/action routes are retained without new routes or migrations:

```text
GET/POST /projectops/project-requests/:id/deliverables
POST     /projectops/project-requests/:id/deliverables/:deliverableId/accept
GET/POST /projectops/project-requests/:id/feedback
POST     /projectops/project-requests/:id/feedback/:feedbackId/address
```

Each child create locks/checks the parent within its insert. Acceptance/addressing lock/check the parent and update only the correct submitted/open child. Concurrent terminal actions therefore have one winner without adding revisions to children. Invalid payloads return 400, genuinely missing parents/children/same-project relationships return 404, and state/duplicate/stale/readiness failures return 409. Zero-row guarded writes use only classification reads afterward. SQL constraint mapping identifies the mutation target rather than accidentally classifying the parent mentioned by a guard. Child writes do not increment project revisions.

Delivery and archival use a small transaction-scoped executor capability: the PostgreSQL pool leases one client for BEGIN, every query, COMMIT/ROLLBACK and release. The transaction explicitly uses READ COMMITTED, locks the project, validates its state and expected project revision, then reads deliverables and feedback in subsequent statements. These reads see a child commit that preceded acquisition of the parent lock, avoiding a stale statement snapshot. The same parent lock excludes relevant child changes until the project transition commits. The existing conditional project revision/state update remains intact. Memory execution mirrors business rules and serializes transaction callbacks with rollback; controlled PostgreSQL tests establish the actual row-lock behavior.

Slice 9 implementation checkpoint `f0052156c5b0fc5c805538023656a8e60b8357c7`, with documentation commit `e74a4b2ef54c90e354a36b8d767cc21e5e70bd3f`, was independently reviewed and merged in PR #6 at `4f17a71f2f844e72a6c3cf87bd5c82e87a2442b8`. Its completion gate passed locally:

| Command | Result |
| --- | --- |
| `pnpm verify` | 72/72 native tests; 575-file hygiene; zero skips |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres` | 19/19; zero skips |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser` | 7/7 Chromium journeys; zero skips |

The cloud runs used Node 24.19.0, pnpm 11.19.0, PostgreSQL 16.15 and Playwright Chromium 153.0.8010.12. Test schemas/operators are isolated and cleaned up. The session used `CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm` for each command and `PLAYWRIGHT_BROWSERS_PATH=/tmp/projectops-playwright` for the browser command. These external cache paths are environment details, not application settings or repository changes. Set the configured test database URL using the environment; do not put credentials in git. No final failures, skips or database/browser blockers remain.

PostgreSQL acceptance proves create/list/actions and terminal metadata across application restart, defaults/optional relationships, every parent-state restriction, missing/duplicate/constraint classification, unchanged rows after failures, project revision behavior and both delivery/archive readiness rules. Controlled barriers prove exactly one acceptance/addressing winner; cancellation/archival winning against all four commands; hold/delivery winning against submission; child submission/open feedback first blocking delivery; acceptance/addressing first enabling delivery; delivery first permitting later feedback; archival versus post-delivery feedback in both orders; and delivery versus cancellation retaining one project revision winner. Chromium covers the full workflow, all sentiments/source attribution, authenticated addressing, reload persistence, safe text/links, validation and missing relationship feedback, stale terminal actions, zero/submitted/open-feedback delivery blockers, delivered archival rechecking readiness, cancelled archival bypass, all relevant state controls, retained read-only records, independent retries and zero page errors.

Slice 9 is merged. Slice 10 completion and review status are recorded below. No deliverable or feedback editing, replacement, versions, rejection, reopening, deletion, uploads, client portal or automatic history is provided. The runtime remains loopback by default and no deployment/final-production-acceptance claim is made.


## Finances (Slice 10)

The protected project workspace provides invoice issue/payment and expense submission/approval/rejection in the isolated project-finances.ts component. Invoices/expenses now use dedicated forms and actions; changes and activities remain on their existing rendering path. No new routes, tables, fields, migrations or child revisions were introduced. Invoice numbers remain unique within a project, amounts remain integer cents from 1 to 1,000,000,000, and currency is trimmed/uppercased to exactly three letters. An optional invoice deliverable must belong to the project and already be accepted; invoice currency can differ from the estimate currency. Existing expense defaults (other, reimbursable true), categories, text/URL validation and monetary inclusion rules remain intact.

| Command | Allowed project states | Child state |
| --- | --- | --- |
| Issue invoice | approved, in_progress, delivered | new → issued |
| Pay invoice | new, estimated, approved, in_progress, on_hold, delivered | issued → paid |
| Submit expense | estimated, approved, in_progress, on_hold, delivered | new → submitted |
| Approve expense | new, estimated, approved, in_progress, on_hold, delivered | submitted → approved |
| Reject expense | new, estimated, approved, in_progress, on_hold, delivered | submitted → rejected |

All omitted states reject the command with 409. Cancelled/archived projects retain readable finance records and workspace totals with no write controls. Repeated payment/expense decisions conflict. Browser controls follow the same state matrix and retain terminal records/metadata. Collection retries are independent; failed invoices make invoice totals unavailable, failed expenses make expense totals unavailable. Success restores only the affected totals. Validation and 404/409 feedback appear in the relevant section; a stale conflict offers deliberate reload. Text-only rendering protects stored user content; receipt links are HTTP(S), without credentials, with noopener/noreferrer.

Protected finance APIs ignore overrides to issuedAtIso, paidAtIso, decidedAtIso and decidedBy. Those timestamps use the server clock, and expense decisions use the authenticated operator. IncurredAtIso is a user business timestamp validated by existing ISO/UTC rules, or server now when omitted. DueAtIso remains user-entered and cannot precede the server issuance timestamp. Browser optional date/time inputs explicitly use UTC; persisted metadata displays in the operator timezone. No other temporal ordering rule is added. The injected unprotected contract-test harness preserves its explicit timestamp/operator inputs, as in Slice 9; the PostgreSQL runtime always enables protected access.

```text
GET/POST /projectops/project-requests/:id/invoices
POST     /projectops/project-requests/:id/invoices/:invoiceId/pay
GET/POST /projectops/project-requests/:id/expenses
POST     /projectops/project-requests/:id/expenses/:expenseId/approve
POST     /projectops/project-requests/:id/expenses/:expenseId/reject
```

All five writes participate in parent-row serialization. Invoice issuance uses Slice 9's transaction-scoped connection: obtain the parent lock, validate the parent, then read an optional same-project accepted deliverable in a new READ COMMITTED statement before a guarded insert. This observes acceptance committed by the preceding parent-lock owner. Expense insertion guards/locks its allowed parent in the insert. Payment/decisions use guarded SQL updates requiring the permitted locked parent, child identity and issued/submitted status. Constraints determine duplicate identity and per-project invoice-number conflicts. A cancelled/archive-first winner prevents insertion/transition; child-first writes may commit before lifecycle changes. No finance write increments the project revision. Memory execution mirrors the rules; controlled PostgreSQL establishes row-lock serialization.

Invalid fields/business dates/domain validation return 400. Genuinely missing parent, invoice, expense or same-project optional deliverable return 404. Disallowed parent/child state, an existing unaccepted deliverable, duplicate, repeated/stale action or lifecycle race returns 409. A guarded zero-row write is followed by only missing-resource classification; those reads never authorize a write.

### Currency aggregation contract

Dashboard rows and summary expose `financeTotalsByCurrency` instead of the old mixed-currency scalar totals. Each actual record currency maps to four **decimal-cent strings**:

```json
{
  "EUR": {
    "outstandingInvoiceAmountCents": "3000000000",
    "paidInvoiceAmountCents": "0",
    "submittedExpenseAmountCents": "0",
    "approvedExpenseAmountCents": "200"
  }
}
```

SQL groups a UNION ALL of invoice/expense amounts by project and currency, then builds JSON with aggregate cents cast to text before joining to projects. It does not multiply invoice/expense rows by joining the two collections. PostgreSQL SUM(integer)'s supported bigint result range is preserved exactly; global native composition and formatting use BigInt, never an unsafe Number conversion or floating-point money arithmetic. Amount fields on individual stored records remain bounded integer numbers. Decimal strings are JSON-compatible; no arbitrary-precision dependency was added. Workspace totals use the loaded record currency and integer arithmetic. Outstanding invoices means issued, paid means paid, and expenses are separated as submitted/approved. Rejected expenses do not contribute; reimbursability does not filter these amounts. No USD assumption, estimate-currency substitution, FX or mixed-currency grand total. The existing dashboard scope excludes cancelled/archived projects, while their workspace records/totals remain visible.

Finances do not participate in Slice 9 readiness: delivery and delivered archival still require only at least one deliverable, all accepted, and no open feedback. Unpaid invoices and submitted expenses do not block either route (/status or /control); cancelled archival continues to bypass readiness. The Slice 9 transaction remains unchanged.

### Slice 10 verification and review checkpoint

Implementation: `9d93bb1ebdf061304434068caff62314569b7c01` on `slice-10-finances`, from authoritative merged main `4f17a71f2f844e72a6c3cf87bd5c82e87a2442b8`. Documentation commit: `d438667199980a26e21be30cdddcbfdb6ca41dac`. Completion gate passed; PR #7 was independently reviewed and merged at `7c341250b6b8ef74b836aeac0dbfac6b88307f99`.

| Command | Pass | Fail | Skip | Hygiene |
| --- | --- | --- | --- | --- |
| `pnpm verify` | 78/78 native | 0 | 0 | 580 files |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres` | 25/25 real PostgreSQL | 0 | 0 | — |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser` | 9/9 Chromium | 0 | 0 | — |

The established cloud setup used Node 24.19.0, pnpm 11.19.0, PostgreSQL 16.15 and Playwright Chromium 153.0.8010.12. Commands used `CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm`, and browser execution additionally used `PLAYWRIGHT_BROWSERS_PATH=/tmp/projectops-playwright`. Supply the configured test database URL through the environment. Dependencies, lockfile and migrations are unchanged. Every database/browser fixture uses an isolated schema removed after testing. No final failed/skipped tests or database/browser blockers remain; initial Chromium datetime-driver normalization and accessible-category-label failures were corrected before rerunning the affected journey and full suites.

Dedicated acceptance files are tests/project-finances.test.ts and integration/finances-postgres.test.ts / finances-browser.test.ts. They cover validation/defaults, all five commands across all eight states, optional accepted relationships and missing/cross-project/unaccepted errors, duplicate IDs/number scope, protected timestamps/operator, terminal actions and stale/repeated rejection, unchanged rows/revisions, access/Origin/JSON/CSRF/no-store and memory parity. Real PostgreSQL covers restart persistence, retained cancelled/archived reads, currency totals above 32-bit range without join multiplication, and aggregate/string normalization above Number.MAX_SAFE_INTEGER. Native aggregation proves exact global sums/formatting above that limit.

Controlled database races hold parent locks or synchronize child preflight reads. Pay/pay, approve/approve, reject/reject and approve/reject each have one successful transition. Cancellation and cancelled-project archival winning against all five commands leave absent/unchanged children; hold blocks invoice issuance but permits the other four commands. Duplicate invoice ID/number and expense ID races insert once. A parent-lock waiter observes preceding deliverable acceptance. Finance-first writes allow ready delivery/archival, and delivery-first transactions permit the approved finance commands in delivered state. Totals count committed winning transitions. The preserved Slice 9 suite continues to prove its delivery/archival predicate and lifecycle revision races.

Chromium proves invoice creation with/without accepted deliverables, missing/unaccepted relationship errors, payment, expense defaults/fields/business date/receipt/decisions, metadata, persistence/reload, validation and stale-tab conflicts, multiple actual currencies differing from the project estimate in both workspace and dashboard, no fake combined total, all eight state controls, retained read-only records, safe text/link rendering, independent retry/unavailable totals and zero page errors. Delivery/archival succeeds with unpaid invoices and submitted expenses when Slice 9 readiness passes.

Slice 10 is merged; Slice 11 completion is recorded below. No invoice/expense editing, deletion, reversal, reopening, partial payments, payment ledger/providers, tax/discounts/refunds, FX, new reimbursement workflow, receipt uploads, generated invoices, finance completion prerequisites or automatic history/notifications were added. No deployment/production-readiness claim is made.


## Automatic history (Slice 11)

Slice 11 implements “Successful actions record events with actor and timestamp; project timeline displays them.” Implementation commits `e80e20c6fc57697162c96761a409805c2ddd4f6e` and identity guard `51f69307da07bc28fc8f30ec64482b58902ebccd` are on `slice-11-automatic-history`, based on independently reviewed Slice 10 merge `7c341250b6b8ef74b836aeac0dbfac6b88307f99` (PR #7). This documentation is the following commit. The completion gate passed locally; Slice 11 remains subject to independent PR review/merge. Slice 12 is next and has not begun.

### Coverage and event contract

The protected completed workflows automatically record exactly one activity for project creation/editing/estimation/approval, start/hold/resume/cancel/deliver/archive, milestone/task creation/editing/rescheduling/completion/reopening, work-log creation, note creation/archival, issue creation/resolution, risk creation/mitigation, document creation/archival, deliverable submission/acceptance, feedback creation/addressing, invoice issuance/payment and expense submission/approval/rejection. No second generic status event is added to estimates or approvals. Rescheduling uses the corresponding edit event.

The original eleven types remain valid. New types are request_edited, milestone_edited, milestone_reopened, task_created, task_edited, task_completed, task_reopened, work_log_added, note_archived, issue_created, issue_resolved, risk_created, risk_mitigated, document_added, document_archived, feedback_added, feedback_addressed, expense_submitted, expense_approved, expense_rejected and operator_annotation. Lifecycle actions use status_changed with the locked source and target states in the summary, so start and resume remain distinguishable. Summaries identify the bounded resource ID/action rather than copying raw user bodies.

Change-request commands are explicitly excluded; their foundational API behavior and concurrency are unchanged. Reads, client management, access/settings and failed/denied/stale/duplicate project commands are not automatic-history triggers. Old activities, including nullable actors and caller-authored legacy metadata, are preserved as stored. No synthetic backfill is performed.

### Migration, identity and time

Migration 0007_automatic_history replaces the activity event_type CHECK with the expanded enumeration. It preserves existing rows/types and adds no columns, sequence, revisions, provenance ledger or resource foreign keys. The deployed 0001 artifact is unchanged. The durable loader now applies seven migrations; clean and pre-0007 upgrade tests verify preservation and invalid-type rejection.

The protected API creates a fresh repository with trusted request-local operator login and clock; identity is never stored on a mutable shared service. Automatic activities use server-generated unique IDs, actual projectRequestId, the command's event type, deterministic summary and operator actor. happenedAtIso is sampled from the server after the winning mutation; createdAtIso uses that audit timestamp. Missing/blank/oversized trusted operator identities fail closed; new automatic entries cannot inherit legacy NULL actors. Business attribution (feedback source, assignee, vendor, approvedBy-like metadata) is not the history actor. Business dates such as expense incurredAtIso and invoice dueAtIso do not become audit timestamps. Existing finance audit timestamps/operators remain server-owned.

### Transaction and concurrency

A reusable repository composition runs the existing guarded command and required activity insert inside one transaction. PostgreSQL leases one connection and uses READ COMMITTED; scoped executor transaction calls join the existing scope without another BEGIN or a pool query. Errors propagate to the outer rollback. Memory composition joins its serialized transaction and restores business/activity maps on failure.

Lifecycle commands capture their source state under the parent lock. Existing invoice/delivery/archival transactions reuse the scope and retain their fresh relationship/readiness reads after parent locking. All existing child guards/revisions remain the business concurrency authority, and parent locks are retained until the activity succeeds. History does not increment parent/child revisions. Cancellation/archive can append their required internal activity after the successful terminal state change; this does not authorize later public writes.

Required history failure rolls back project creation, project/child edits, state changes and revisions. No committed business mutation can silently omit its required activity. Validation/missing/state/stale/duplicate/denied commands create no success history. Retrying a committed command retains its established revision/identity/status semantics; no general network idempotency mechanism is introduced. SQL ordering remains happened_at DESC, created_at DESC, id ASC; tied timestamps have stable ID ordering, not a strict commit sequence.

Controlled tests synchronize competing reads or pause a real winning transaction immediately before history insertion while it still owns its parent lock. Project/planning/execution/delivery/feedback/finance races produce one corresponding winner/event. Concurrent independent contexts preserve different actors. Duplicate resource identities/invoice numbers and forced annotation-ID collisions insert once. Lifecycle-first blocks child mutation; child-first commits business/history before lifecycle business/history. Delivery and delivered archival observe preceding submission/acceptance/open-feedback/addressing outcomes, permit post-delivery feedback and serialize archival against it. Cancellation-versus-delivery keeps one revision winner. Lock observations are scoped to each new history fixture's application name.

### Annotation API and timeline

Existing GET /projectops/project-requests/:id/activities remains protected, no-store and readable in every project state. Existing protected POST now accepts only `{ "summary": "..." }`: required bounded text up to 500 characters. Server supplies ID, operator_annotation, authenticated actor and both audit timestamps. Caller ID/event/actor/time fields are rejected with 400; no new route is added. A transaction locks and validates the parent before insertion: all nonterminal states are allowed, cancelled/archived yield 409, missing parent yields 404. Duplicate identity errors map consistently in PostgreSQL/memory. Unprotected injected contract harnesses retain their old activity input contract; they are not the durable production security boundary. Protected workflow execution fails closed if transactional history support is absent.

project-history.ts owns workspace History: labeled events, summary, stored actor, operator-timezone timestamp, safe text, loading/empty/unavailable states and independent Retry history. Nonterminal projects can add summary-only annotations; terminal projects retain read-only records. Every successful workspace mutation refreshes history independently, with a request generation guard against old responses. If history GET fails after business success, business success remains intact and only history becomes unavailable; retry never repeats the command. Existing latest-activity dashboard fields reflect automatic records without new dashboard features.

History is not a completion prerequisite. Slice 9 still requires at least one deliverable, all accepted, and no open feedback for delivery/delivered archival; cancelled archival bypasses readiness. Unpaid invoices/submitted expenses remain irrelevant to readiness. Slice 10 actual-currency decimal-cent string totals and BigInt precision, active dashboard scope and audit/business date ownership are unchanged.

### Verification and limitations

| Command | Pass | Fail | Skip | Hygiene |
| --- | --- | --- | --- | --- |
| `pnpm verify` | 85/85 native | 0 | 0 | 587 files |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres` | 32/32 real PostgreSQL | 0 | 0 | — |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser` | 10/10 Chromium | 0 | 0 | — |

Executed in the established cloud setup with Node 24.19.0, pnpm 11.19.0 and PostgreSQL 16.15. Commands used `CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm`; Chromium also used `PLAYWRIGHT_BROWSERS_PATH=/tmp/projectops-playwright`. A configured local dedicated test database was used; all fixtures isolate and remove their schemas. No dependency or lockfile change was needed.

Dedicated tests/project-history.test.ts, tests/history-fixture.ts and integration/history-postgres.test.ts / history-browser.test.ts verify every trigger, failed retries, trusted identity/time, protected annotation forgery/errors, preservation of business timestamps, revisions, persistence/restart, legacy migration/ordering, latest activity, terminal reads and rollback before every covered successful command. Real PostgreSQL history-insert fault injection proves all business/history rollback paths. Native/API coverage retains protected route access/Origin/JSON/CSRF/no-store and compatibility status/control behavior. Previous Slice 1–10 suites remain enabled.

Chromium exercises completed project controls, Planning, Execution, Delivery/Feedback and Finances without manually seeded workflow events; verifies annotations, safe text, actor/timezone, stable newest-first ordering, reload persistence, stale terminal conflicts without false history, independent history GET failure/retry without business resubmission, old response protection, terminal visibility and zero unexpected page errors. The complete browser suite passed.

No final failure, skip or environment blocker remains. Initial PostgreSQL failures were migration-count/version assertions still expecting six migrations; these were updated to include 0007 and the full suite rerun. Earlier focused test corrections addressed legacy NULL actor expectations, real runtime clock assertions and multiline SELECT matching in the controlled barrier. All final suites passed after lifecycle source-state summaries were strengthened.

Bounded limitations: no automatic change-request history or concurrency redesign, history editing/deletion/backfill, strict sequence ledger, cryptographic audit ledger, general request idempotency, pagination, notifications/queues/integrations, new dashboard features, deferred finance features, export or deployment/backup/final-production acceptance. Single-operator access remains unchanged; distinct trusted contexts test attribution isolation without adding team accounts. Slice 12 has not begun.
