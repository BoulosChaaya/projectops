# Running ProjectOps with PostgreSQL

Requires Node 22.6+, pinned pnpm 9.12.0 and PostgreSQL 16+. The approved Render release uses Node 24.19.0. The runtime protects ProjectOps pages and APIs with operator sessions. It is not yet deployed.

```bash
pnpm install --frozen-lockfile
# Supply DATABASE_URL through private environment configuration.
pnpm operator:create < "$PROJECTOPS_OPERATOR_INPUT"
pnpm start
```

Keep actual credentials outside git. Configure PostgreSQL TLS through the connection URL; certificate verification is not disabled by application code. HOST defaults to 127.0.0.1 and PORT to 3000. The database must already exist. Provision once using a private JSON input file with `login` and `password` fields, a password of at least 12 characters, and file permissions 0600. Keep the file outside the repository and delete it after provisioning. The command never overwrites an existing operator. Open /projectops/login to sign in, /projectops for the summary dashboard, and /projectops/settings to change credentials or defaults; API routes are under /projectops. SIGINT/SIGTERM close the HTTP server and database pool.

Startup applies the frozen migration artifacts in a transaction and records their names/checksums in projectops_schema_migrations. Concurrent startup is serialized. Subsequent startup verifies and skips applied versions. Do not edit an applied artifact; add and register the next version. Startup refuses existing ProjectOps tables without a ledger: back up and prepare an explicit legacy migration before using such a database.

## Verification

```bash
pnpm verify
# Supply PROJECTOPS_TEST_DATABASE_URL for a dedicated test database privately.
pnpm test:postgres
pnpm test:browser
```

The PostgreSQL acceptance command fails if its URL is missing. It creates unique test schemas and removes only those schemas afterward. Use a dedicated test database and a role allowed to create schemas. Slice 14 recovery/release/final fixtures additionally create/drop only uniquely named whole disposable databases; their test role needs CREATEDB. Never point acceptance at a production database. It checks API writes and dashboard reads across application restart, simultaneous migration startup, a new migration version, checksum drift, transactional rollback and unmanaged-schema refusal. GitHub Actions runs it against PostgreSQL 16.

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

The client API provides GET /projectops/clients?q=...&status=active|archived|all (default all; paginated, see *List pagination* below), PUT /projectops/clients/:id for full contact-field replacement, POST /projectops/clients/:id/archive, and GET /projectops/clients/:id/projects. Edits and archives require expectedRevision from the current client response. A stale revision or archived client returns 409; the browser offers a deliberate reload. Empty optional contact/email fields clear them. Search treats SQL wildcard characters literally and is case-insensitive.

Migration 0003 adds client revisions without changing existing records. Conditional SQL updates prevent lost edits. Project insertion locks and checks the client row, so a concurrent archive cannot be bypassed. Native, PostgreSQL and Chromium checks run through the existing verification commands.

## API response contract

API responses are camelCase domain objects (`contactName`, `projectRequestId`, `createdAtIso`); database column names never appear. The PostgreSQL executor copies single-word columns (whose names are already correct) and maps every multi-word column explicitly; the memory executor used by native tests returns the same fields, and `tests/integration/contract-postgres.test.ts` enforces both rules for every read and write endpoint. Timestamps are ISO 8601 strings in fields ending in `Iso`; money is integer cents with a separate currency.

Empty optional values are currently represented two ways: multi-word fields (such as `budgetRange`) are omitted, while some single-word fields (such as `owner` or `vendor`) are `null`. Clients must treat a missing field and `null` the same way.

## List pagination

GET /projectops/clients and GET /projectops/project-requests return one page: `{ "items": [...], "nextCursor": "..." | null }`. `limit` is an integer from 1 to 100 (default 50). To read the next page, repeat the same request with `cursor=<nextCursor>`; `nextCursor` is null on the last page. Invalid limits return 400 `INVALID_PAGE_LIMIT`; malformed, tampered or wrong-list cursors return 400 `INVALID_PAGE_CURSOR`. Cursors are opaque: do not build or edit them.

Pagination is keyset-based. Clients are ordered by creation time (newest first, then id) and projects by last update (then creation time, then id); a cursor records the sort key of the last row returned, and the next page is an indexed range read that starts after it (migration 0008). Records created while someone pages appear before the cursor, so later pages never repeat or shift. A project edited during paging moves to the front and can be missed or shown once more; that is inherent to ordering by last update. Per-client and per-project collections (a client's projects, a project's tasks, notes and so on) are bounded by their parent and are not paginated.

The client directory loads 50 clients and offers **Load more clients**; a new search starts again from the first page.

## Errors and logs

Error responses are `{ code, message, status, correlationId }` and never include stack traces, SQL or internal messages. Client errors keep their specific code (400 validation, 401 session, 403 origin or CSRF, 404, 409 conflicts). An unexpected failure returns 500 `INTERNAL_SERVER_ERROR`. When PostgreSQL cannot be reached (connection refused or dropped, server shutting down, pool connect timeout, too many connections) requests return 503 `SERVICE_UNAVAILABLE` with `Retry-After: 5` instead of 500, and `/health/ready` returns 503 `SERVICE_NOT_READY`; the pool reconnects on its own when the database returns, without restarting the process.

The process writes JSON lines to stdout: `timestamp`, `level`, `message` and `context`. Each request logs `http.request.completed` (info), `http.request.error` (warn, client errors) or `http.request.failed` (error, server errors) with the correlation id (also returned in the `x-correlation-id` header), method, path, code and status. Paths are logged without their query string, because queries carry search text. Failed requests also log `error`: the error's name, message, code, stack frames and up to three causes, plus PostgreSQL's `severity`, `schema`, `table`, `column`, `constraint` and `routine` when present. PostgreSQL `detail` and `where` (which quote row values) and query parameters are never logged, and credentials in connection strings are redacted. A deliberate server response such as `SERVICE_NOT_READY` is logged by its code without a stack. Errors on idle pooled connections, typically the first sign of a database restart, are logged as `db.pool.error`.

To trace a report, take the `correlationId` from the error response and search the log for it.

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

Slice 11 implements “Successful actions record events with actor and timestamp; project timeline displays them.” Implementation commits `e80e20c6fc57697162c96761a409805c2ddd4f6e` and identity guard `51f69307da07bc28fc8f30ec64482b58902ebccd` are on `slice-11-automatic-history`, based on independently reviewed Slice 10 merge `7c341250b6b8ef74b836aeac0dbfac6b88307f99` (PR #7). Documentation commit `acacf3471e6b7ffcefac2d57629800fa8afb9eae`; PR #8 independently reviewed and merged Slice 11 at `8aff0138ea5857eacbb5f71c2e829c5bfa3c9496`. Slice 12 completion is recorded below.

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

Bounded limitations: no automatic change-request history or concurrency redesign, history editing/deletion/backfill, strict sequence ledger, cryptographic audit ledger, general request idempotency, pagination, notifications/queues/integrations, new dashboard features, deferred finance features, export or deployment/backup/final-production acceptance. Single-operator access remains unchanged; distinct trusted contexts test attribution isolation without adding team accounts. Slice 11 is merged; the completed Slice 12 contract is recorded below.


## Operational dashboard (Slice 12)

Open /projectops. Apply project-title/client-name search and an eligible-state filter; Reset returns to all eligible projects. Forms use GET q/status parameters, preserving bookmark/reload/back-forward behavior. Every displayed count, money aggregate and operational section follows the selected scope. q is trimmed, limited to 120 characters and matched as a case-insensitive literal substring in exactly title or client name. SQL uses lower with C.utf8 collation and native/memory normalization mirrors simple lowercase, making matching independent of the database's default locale. Wildcards/quotes/backslashes are ordinary data. status is omitted/all, new, estimated, approved, in_progress, on_hold or delivered. Invalid filters produce 400; valid no matches produce 200.

Dashboard scope excludes only cancelled/archived projects. Archived clients' eligible existing projects remain included. All six states, including On Hold, have coherent presentation. Cancelled/archived records remain accessible through existing client/workspace navigation.

### Operational dates

One server evaluationNow is sampled per request and passed to SQL/composition. The protected route ignores caller evaluationNow. Overdue work is only OPEN tasks/milestones with dueAtIso < evaluationNow. Equal instants, future dates, absent dates and completed children are excluded. No local-calendar-day rule, stored flag or date repair is added. Existing valid open work remains derived from source; no planning children are invented for new projects.

Upcoming means strictly > evaluationNow, with no 7/14/30-day horizon. Sources are project deadlineIso and OPEN milestone/task dueAtIso. Delivered project deadlines are excluded, while delivered open planning deadlines and overdue work remain relevant. Invoice due dates, history, expenses and execution/delivery audit timestamps are not planning attention dates.

Each project contributes its nearest future operational item. Overdue work exposes complete counts and the earliest overdue task/milestone per project/type. Date ordering compares actual instants and uses stable project ID/kind/resource ID ties. PostgreSQL nearest-resource ID ties use C collation; memory mirrors that order. Source rows retain updated_at DESC, created_at DESC and add ID ASC. Offset-bearing equivalent instants classify/order equivalently. Displayed deadlines, evaluation and latest activity dates use the authenticated operator's saved IANA timezone, including when browser/server timezones differ. No business timestamp ownership changes.

### Money and consistency

Outstanding invoices are ISSUED, whether due-dated or not; paid invoices are excluded. The section shows counts and amounts by actual invoice currency and links to #invoices. Financial dates remain financial information rather than overdue work/upcoming deadlines. Existing four financeTotalsByCurrency categories remain decimal-cent strings; SQL groups invoice/expense sources before joining and native formatting/composition uses BigInt. No Number precision loss, FX, combined unlike-currency total or estimate-currency substitution.

The repository performs one parameterized SELECT statement: a scope-existence CTE plus filtered project/client rows and independently grouped child/finance aggregates, nearest-date metadata and latest activity. The existence boolean distinguishes no eligible projects from filtered-empty results without exposing unfiltered metrics. There is no N+1 workspace collection fetching and no dashboard row lock. A PostgreSQL statement snapshot sees committed business/history together. During an uncommitted mutation it may show the prior state; refresh after commit sees the winner. Completion removes planning attention, reopen/reschedule recalculates it, payment/expense decisions update finance categories, cancellation/archive removes projects and delivery retains eligible child/financial information while excluding the delivered project deadline. Legacy nextDeadline remains a compatibility field for the earliest unfinished project deadline; upcomingDeadlines is the explicit future-only projection.

Reads/search/filter/refresh produce no activity, change no revisions and authorize no actions. Slice 9 delivery/archival readiness remains only at least one deliverable, all accepted, no open feedback; cancelled archival bypass is unchanged. Finance/attention/history remain irrelevant to readiness. Slice 11 successful mutation/history atomicity, request-local actors, annotations, failed-command exclusions and change-request exclusion are untouched.

### Browser and access

The dashboard remains protected request-time SSR, with no polling or client-data islands. Query/storage failure renders an unavailable 500 page with Retry dashboard preserving q/status and no authoritative-looking zero metrics. Empty eligible scope, filtered-empty results and empty overdue/upcoming/invoice sections have distinct messages. Text is escaped, internal links encoded and sections navigate the established planning/finance workspace. Existing responsive table/card layout is retained. Invoices for … labels distinguish financial navigation from overview links.

Existing GET /projectops and GET /projectops/dashboard are sufficient. They share filter validation, retain no-store/session boundaries and page login redirects/API 401 behavior. No new read 409 contract or GET mutation-CSRF requirement is added. Existing write Origin/JSON/CSRF guards remain enabled.

### Verification and checkpoint

Implementation commit `7aed95e2039f4b7a3a8531bab0b2952f45eb9af1` on slice-12-operational-dashboard, based on merged main `8aff0138ea5857eacbb5f71c2e829c5bfa3c9496` (PR #8). Documentation commit `a507e900a0017c796d2c79fd80ad12ddd7277341`; PR #9 was independently reviewed and merged at `7fa7f4b3caafbd55c63952f1328721d4ff65ed91`. Slice 13 completion is recorded below.

| Command | Pass | Fail | Skip | Hygiene |
| --- | --- | --- | --- | --- |
| pnpm verify | 89/89 native | 0 | 0 | 591 files |
| PROJECTOPS_TEST_DATABASE_URL=<configured-test-database> pnpm test:postgres | 34/34 real PostgreSQL | 0 | 0 | — |
| PROJECTOPS_TEST_DATABASE_URL=<configured-test-database> pnpm test:browser | 11/11 Chromium | 0 | 0 | — |

Actual commands also used CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm; browser used PLAYWRIGHT_BROWSERS_PATH=/tmp/projectops-playwright. Node 24.19.0, pnpm 11.19.0, PostgreSQL 17.11 and Chromium 153.0.8010.12. The restored cloud image lacked PostgreSQL binaries, so signed Debian package metadata/checksum-verified PostgreSQL 17 packages were extracted outside the checkout and a dedicated loopback test instance initialized. Existing data was untouched; all acceptance schemas were isolated and cleaned. PostgreSQL 17 meets the runtime's PostgreSQL 16+ requirement. No dependency, lockfile, frozen migration 0001–0007, index or database-schema change.

Four dedicated native tests plus dashboard-fixture.ts cover memory/domain/repository/API contracts, strict boundaries and offset/identity ordering, read-only behavior, full filtered scope, exact currencies, protected clock/timezone, invalid queries and failure rendering. Two real PostgreSQL tests cover query/persistence/refresh behavior and controlled snapshots during business/history transactions, with restart through a fresh pool. Chromium exercises realistic complete source workflows with automatically generated history, search/title/client/status combinations, URL/apply/reset/back-forward, all six states, delivered planning rules, separate currencies, workspace navigation, timezone, three empty-state classes, unavailable/retry filters, responsive safe rendering, unchanged projects/history, no business requests and zero page errors. Prior Slice 1–11 suites remain enabled.

Controlled PostgreSQL pauses task/milestone completion, payment and cancellation before required history insertion. Unlocked dashboard reads see the previous committed state; commit exposes the winner and its latest activity together. Injected required-history failure rolls back business/history and preserves the previous dashboard. Existing complete Slice 9 readiness/concurrency, Slice 10 exact totals above Number.MAX_SAFE_INTEGER and Slice 11 rollback/concurrency acceptance also passed.

Initial failures were corrected and full suites rerun: direct SQL finance acceptance supplies statement parameters, status markup has an explicit label, invoice navigation has a distinct destination label and case matching no longer depends on default database locale. No test was skipped or weakened. No final runtime blocker remains. Limitations: manual refresh/statement snapshots, bounded nearest operational metadata, PostgreSQL C.utf8 availability, no speculative indexing/live notifications/export/deployment/backup/production-acceptance claim was made by Slice 12. Slice 12 is merged; the completed Slice 13 contract is recorded below.


## Export and handoff (Slice 13)

Open a project workspace and choose **Export project information** or **View delivery summary** in Export and handoff. Both work in new, estimated, approved, in_progress, on_hold, delivered, cancelled and archived states, including archived clients’ existing projects. The internal export is not declared client-safe. The protected summary is deliberately narrower; it does not establish public access, client accounts, new roles or sharing links.

### Internal JSON attachment

GET /projectops/project-requests/:id/export returns application/json; charset=utf-8 with attachment Content-Disposition and fixed sanitized-ID filename projectops-project-<safe-id>.json. Never use the raw title in a response header. Project IDs follow the existing ASCII alphabet and 80-character bound. Format is projectops.internal-project, version 1, with server generatedAtIso/authenticated generatedBy, explicit project and client records, collections and financeTotalsByCurrency.

Collections are milestones, tasks, workLogs, notes, issues, risks, documents, deliverables, feedback, invoices, expenses, activities and changeRequests. Explicit allowlisted DTOs preserve existing model fields: IDs/parent and optional child relationships, revisions where present, statuses/enums, actors/authors/business attribution, audit metadata and timestamps. This is not raw SQL-row serialization. No passwords, cookies, tokens, CSRF, environment/database configuration, infrastructure, unknown columns or unrelated projects/clients/resources. Change requests remain existing read-only records; their concurrency/automatic-history exclusion is unchanged.

Dates are canonical ISO instants; optional absent fields are null; empty collections are []. Existing collection order is preserved with actual-instant comparison and stable ASCII ID ties. History stays happened_at DESC, created_at DESC, id ASC; no strict commit sequence claim. Complete collections are exported without silent truncation. URLs remain data, never fetched remotely or bundled into files.

Individual money fields remain existing safe bounded integer cents. Four aggregate categories remain exact decimal-cent strings by actual currency, calculated using existing BigInt helpers from the same invoice/expense snapshot. Rejected expenses contribute to neither submitted nor approved totals; reimbursability does not change inclusion. No unsafe Number aggregation, FX, mixed-currency grand total or estimate-currency substitution. Cancelled/archived exports use their own source records rather than the active-only dashboard. JSON encoding preserves decimal-cent strings beyond Number.MAX_SAFE_INTEGER.

### Protected delivery/handoff summary

GET /projectops/projects/:id/delivery-summary is protected HTML with safe escaping, CSP, return navigation, print CSS and Print summary (browser print, no server PDF). It includes only:

- Project ID/title, associated client name and actual current status.
- Accepted deliverables with identity/title, safe artifact link and actual submittedAtIso/acceptedAtIso; associated milestone identity/title/status/due context only where the existing relationship resolves.
- Active notes whose existing visibility is client, with body/identity/creation timestamp.
- Active documents whose existing documentType is handoff, with title/link/identity/upload timestamp.
- Server generation time and the operator’s saved IANA timezone, clearly labelled. Human dates use that timezone even when browser/server timezones differ.

The approved classifications now determine the bounded handoff disclosure subset. Internal/archived notes, non-handoff/archived documents, general tasks, work logs, issues, risks, feedback narrative, invoices, expenses/totals, activities/annotations and change requests are omitted. No full project brief, budget, client contact record or estimate is disclosed. Empty selected sections show explicit messages. Only HTTP(S) URLs without username/password are links; unsafe legacy values show Link unavailable and are not exposed as clickable links or embedded credential text. Safe external links use target=_blank and rel=noopener noreferrer.

Every state except delivered/archived prominently says CURRENT / DRAFT and displays actual status without certifying delivery/completion. Delivered shows its actual state without a manufactured delivery date. Archived displays archived and explicitly declines to infer whether it followed delivery or cancellation. No deliveredAtIso/acceptedBy exists or is invented; absent legacy acceptance time is Not recorded. Stored source/business/audit timestamps are not replaced by generation time. HTML does not expose internal generation operator metadata.

### Snapshot, access and concurrency

One parameterized SELECT returns root project/client and independently aggregated complete collections. No per-row/N+1 calls, FOR UPDATE, write locks, join multiplication, new transaction/isolation setting or database abstraction redesign. The existing memory executor takes one project-scoped serialized snapshot; common DTO composition/order/money rules provide parity. Each artifact has one committed statement snapshot; separate requests read fresh snapshots. Query/source/encoding failure rejects the artifact rather than silently filling missing collections with zeros/empty lists.

During an uncommitted covered business+required-history transaction, generation can read prior committed business/history without taking its parent lock. After commit/refresh it sees both the winning mutation and event. Forced required-history failure leaves the prior source/artifact. Controlled acceptance pauses project editing, task completion, issue resolution, deliverable acceptance, feedback addressing, invoice payment, expense approval, delivery, archival and cancellation immediately before history insertion; a paused client edit is observed only after its own commit. No new concurrency authority or read locks. Existing project/child revisions and lifecycle serialization remain unchanged.

Generation/view/print/retry/refresh create no workflow activity/annotation, update no project/child revision or source resource, and persist no artifact. Established session last_seen maintenance still applies. Slice 9 readiness remains only at least one deliverable, every deliverable accepted, no open feedback for delivery/delivered archival; cancelled archival bypass is unchanged. Finance, history and exports remain irrelevant to it. Slice 10 money/audit/business-date semantics and Slice 11 automatic history/actor/rollback guarantees remain unchanged. Slice 12 dashboard query/filter/scope/timezone/attention semantics are untouched.

Both routes are covered by existing operator session protection/no-store, with nosniff. Unauthenticated export returns 401; summary follows the existing page login redirect. Bounded invalid identifiers/query overrides return 400, genuinely missing project 404, storage/source/encoding/render failure useful unavailable 500. Error responses are not downloadable attachments and disclose no private storage details. Caller generation identity/time/include/timezone overrides are not supported (400). No ordinary read 409 or GET mutation CSRF/JSON-body requirement; existing write Origin/JSON/CSRF protections remain enabled. No public capability URL.

The isolated project-handoff.ts workspace controls keep download progress/unavailable/Retry export independent from source sections. Summary errors show unavailable/retry; 404/400 are explicit. Retry repeats only the artifact read, never a business command or history refresh. Terminal controls remain available even when other workspace commands are read-only.

### Verification, checkpoint and limitations

Implementation commit `7f78b70f9ce54e6e621c66745f331288bb58372b` on slice-13-export-handoff from authoritative merged PR #9 checkpoint `7fa7f4b3caafbd55c63952f1328721d4ff65ed91`. This documentation is the following commit. Slice 13 passed its completion gate; PR #10 independently reviewed and merged at `3b8e33ae536fd68c6e0abf58c9603ec2906b2ab8`. Slice 14 pre-deployment evidence is recorded below.

Exact executed cloud commands (dedicated non-secret local test URL; no production credentials):

```bash
CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm pnpm verify
PROJECTOPS_TEST_DATABASE_URL=postgresql://projectops_test@127.0.0.1:55432/projectops_test CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm pnpm test:postgres
PROJECTOPS_TEST_DATABASE_URL=postgresql://projectops_test@127.0.0.1:55432/projectops_test PLAYWRIGHT_BROWSERS_PATH=/tmp/projectops-playwright CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm pnpm test:browser
```

| Command | Pass | Fail | Skip | Hygiene |
| --- | --- | --- | --- | --- |
| pnpm verify | 94/94 native | 0 | 0 | 598 files |
| pnpm test:postgres | 37/37 real PostgreSQL | 0 | 0 | — |
| pnpm test:browser | 12/12 Chromium | 0 | 0 | — |

Node 24.19.0, available pnpm 11.19.0, PostgreSQL 17.11 and exact Chromium 153.0.8010.12. Reused the already verified dedicated loopback database and Playwright cache; no additional setup/configuration was needed. Fixtures create/remove isolated schemas. No migration, new revision, schema/index, dependency or lockfile changes. Frozen migrations 0001–0007 are intact.

Five dedicated native tests cover exact all-model inclusion/strict disclosure, all states/archived clients, terminal/empty source, nulls/relationships/legacy actors, offset-equivalent/tied ordering, Unicode/quote/comma/newline/markup JSON round-trip, safe HTML/URLs/filename, exact currency totals and safe-integer encoding boundary, trusted generation context/override rejection, read-only memory parity, failure classification/partial-download rejection and 301-task completeness. Three PostgreSQL tests cover complete source/disclosure/relationships, same-project isolation and independent aggregates, 252-task completeness, source pool/application restart, terminal visibility, exact database aggregate/string boundary above Number.MAX_SAFE_INTEGER, unchanged source/history/revisions, seven-migration preservation and the controlled mutation/history/client snapshots above. Chromium downloads/parses JSON, navigates summary in all eight states, checks approved disclosure/milestone/notes/documents, safe text/legacy URL, operator timezone, draft/cancelled/delivered/archived language, empty sections, print media/button, reload, missing project, independent export and summary failure/retry, no business requests/new activity/revisions and zero page errors. Prior Slice 1–12 acceptance remains enabled and passed.

No final failures/skips/environment blockers. Initial focused PostgreSQL fixture ordering attempted intake after client archival; moving its setup before archival preserved and continued testing the established archived-client intake rejection. No assertion was weakened or skipped. Limitations: complete current project artifacts are buffered in memory, not streaming/live feeds/persisted historical reports; larger project tests prove no silent truncation but do not claim unbounded resource capacity. No CSV/PDF/ZIP, remote files, public/client sharing, stored reports/jobs/notifications, automatic change-request history, new finance features, strict sequencing/idempotency, deployment/backup/restore/final real-project acceptance or production-readiness claim. Slice 14 pre-deployment evidence is recorded below; actual deployment remains pending.


## Deploying on Render

ProjectOps runs on Render as one native Node web service with one managed PostgreSQL database, both declared in [`render.yaml`](../../render.yaml) (a Render Blueprint). `tests/deploy-config.test.ts` keeps the Blueprint tied to what CI tests.

### What the Blueprint creates

| Setting | Value | Why |
| --- | --- | --- |
| Web service | `0.5c-512mb` (smallest paid, about $7/month) | Never sleeps; includes the dashboard Shell used for provisioning |
| Database | `0.1c-256mb`, PostgreSQL 16, 1 GB disk (about $6/month) | Free databases are deleted after 30 days; the tier's default 15 GB disk would be billed per GB. Disks can grow later, not shrink |
| Region | `frankfurt` for both | Closest to the owner; the service reaches the database over Render's private network only within one region. Fixed at creation |
| Database access | `ipAllowList: []` and the internal `connectionString` | No connections from the internet at all |
| Node | `NODE_VERSION=24.19.0` | The version CI runs acceptance on |
| Build | `corepack pnpm install --prod --frozen-lockfile` | pnpm 9.12.0 from `packageManager`; installs only `pg` |
| Start | `node --experimental-strip-types scripts/projectops-render-start.mjs` | Sets `PUBLIC_ORIGIN` from `RENDER_EXTERNAL_URL` (the generated `https://…onrender.com` origin), then starts the app |
| Health check | `/health/ready` | A new instance receives traffic only once PostgreSQL answers |
| Deploys | `autoDeployTrigger: checksPass` | A commit on `main` deploys only after its GitHub Actions checks pass. `main` changes only through reviewed, merged pull requests, so merging is the deploy approval |

Prices are from Render's pricing page in October 2026; Render shows the exact plan before you apply the Blueprint.

### How a deploy behaves

1. Render builds the new commit and starts a new instance next to the running one.
2. On start, the app applies pending migrations in a transaction under a PostgreSQL advisory lock (verifying the checksums of applied ones), then binds HTTP. A failed migration rolls back and the instance never becomes healthy.
3. When `/health/ready` passes, traffic moves to the new instance. About 60 seconds later the old instance receives SIGTERM, closes its HTTP server and database pool, and exits within Render's 30-second shutdown limit.

Because old and new code overlap for about a minute, **a migration must stay compatible with the previous release**: add columns and tables freely; rename or drop only in a later release, after no deployed code uses them.

A failed build, failed migration or failing health check leaves the previous version serving. To roll back, use **Rollback** on an earlier deploy in the service's Events page; migrations are never reversed, so roll back only to a commit whose code works with the current schema.

### First deployment

1. In Render: **New → Blueprint**, select this repository and `main`. Review the two resources, plans and region, then apply. The first deploy starts immediately.
2. When the service shows **Live**, open its **Shell** tab and create the operator. The command needs only `DATABASE_URL`, which the service environment already has:
   ```bash
   node --experimental-strip-types apps/api/src/projectops/provision-operator.ts
   ```
   Paste `{"login":"…","password":"…"}` (password at least 12 characters), press Enter, then Ctrl-D. It prints `ProjectOps operator created.` and never overwrites an existing operator. Credentials go through stdin, not the command line or shell history.
3. Sign in at `https://<service>.onrender.com/projectops/login`.

### Verifying a deployment

`GET /health/live` reports the commit the instance runs (`details.commit`, from Render's `RENDER_GIT_COMMIT`), so the deployed version is observable from outside.

The **Deployed smoke** GitHub Actions workflow (`.github/workflows/deployed-smoke.yml`, started by hand) runs `scripts/projectops-deployed-smoke.mjs` against the live service. It needs repository secrets `PROJECTOPS_OPERATOR_LOGIN` and `PROJECTOPS_OPERATOR_PASSWORD` and the repository variable `PROJECTOPS_ORIGIN`.

- **initial** first checks that the live commit equals `main`'s head (run it after the deploy finishes). It then checks health, page and API access control, the `__Host-` Secure/HttpOnly/SameSite=Strict session cookie, Origin/CSRF/JSON rejection, `no-store` and `nosniff` headers, and the workspace CSP. It runs one project through estimate, approval, start, delivery, feedback, an EUR invoice payment, a USD expense approval, delivery and archive in Chromium, then checks the 14 history events, exact totals, export, handoff summary, dashboard and dashboard search (which needs PostgreSQL's `C.utf8` collation). It writes one archived client and project named "ProjectOps deployed acceptance" and prints a JSON receipt with their ids and a snapshot digest.
- **after-restart**: restart the service in Render (Manual Deploy → Restart), then run the workflow with this phase and paste the receipt. It re-reads the archived project and saved settings and compares them with the receipt. It writes nothing.

Failures name the check that failed; credentials are never printed. The workflow log is public on a public repository, and the receipt contains only ids, a digest and the operator's saved defaults.

### Logs, backups and limits

- Logs are the JSON lines described in [Errors and logs](#errors-and-logs), viewable in the service's Logs tab; Render keeps them for 7 days on the Hobby workspace.
- The paid database has point-in-time recovery (3 days on the Hobby workspace), restored by Render into a new database. Check the database's page in Render for the current window.
- The pool opens at most 10 connections per instance; the database allows 100.
- The backup and restore drill below needs network access to the database, which this Blueprint does not allow from outside Render.

## Backup and restore drill

`scripts/projectops-recovery.mjs` takes a `pg_dump` custom-format backup and proves it restores, without touching the source database. It reads a JSON request on stdin and uses private libpq service files: `PGSERVICEFILE` (and optional `PGPASSFILE`) must be absolute, non-symlink regular files inaccessible to group and others, with named source and maintenance profiles. Passwords live only in those files, never in arguments, receipts or docs. `psql`, `pg_dump` and `pg_restore` must be on `PATH`, no older than the server's major version.

```bash
node --experimental-strip-types scripts/projectops-recovery.mjs < "$PROJECTOPS_BACKUP_REQUEST"
node --experimental-strip-types scripts/projectops-recovery.mjs < "$PROJECTOPS_RESTORE_REQUEST"
```

- **Backup** (`action: "backup"`, `sourceService`, `sourceIdentity`, optional private `directory` outside a checkout, optional 40-hex `checkpoint`): writes a new 0600 archive (never overwriting), checks it lists and hashes correctly, fingerprints the source before and after, and writes a receipt with versions, size, SHA-256 and schema/ledger/data digests. It refuses a source that changed during the backup.
- **Restore drill** (`action: "restore-drill"`, `sourceService`, `maintenanceService`, `archive`, `targetDatabase`): the target must be a fresh `projectops_restore_` + 32 hex name (from `newRestoreDatabaseName`). It creates that database from `template0` (an existing database, even an empty one, is never adopted), restores with `--exit-on-error --single-transaction --no-owner --no-acl` (never `--clean`), compares the schema, migration ledger and every row with the source, and drops only the database it created. The CLI returns `applicationVerified: false`; `restoreDisposableBackup` accepts a `verifyApplication` callback that starts the real application against the restored database before cleanup, which the recovery acceptance tests use.

Archives contain all application data, operator password hashes and session records, and compression is not encryption: keep them in private, access-controlled storage and never commit them.

## Source-runtime release

`scripts/projectops-release.mjs` copies the runtime (apps, packages, migrations, manifests, lockfile, Render start wrapper and Blueprint) into a new private directory outside the checkout, without tests, Git data, environment files or `node_modules`, and writes a manifest of file hashes and the source commit. A frozen production install is still needed there. Render builds from Git and does not use it; `release-postgres.test.ts` uses it to prove the runtime starts, provisions an operator with a Render Shell's environment, survives SIGTERM and restart, and refuses invalid configuration outside the development checkout.
