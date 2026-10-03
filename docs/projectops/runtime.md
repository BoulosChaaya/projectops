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

Settings persist currency, priority and an IANA timezone. New project requests use the saved priority when omitted; estimates use the saved currency when omitted. Explicit values still win and are validated. Timezone is retained for later workspace display; existing stored timestamps remain ISO UTC. Currency settings do not fix mixed-currency dashboard totals, which belong to the finances slice.

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

Deadline inputs explicitly use UTC; displayed dates use the operator's saved IANA timezone. API deadlines remain ISO instants and cannot precede project creation. Forms reject invalid input and offer a deliberate reload on 409 conflicts. Planning, execution and delivery controls are described below. Finance commands and automatic history remain their later approved slices; this workspace connects their current records.

## Estimates and project controls

The workspace lets the operator save or revise an estimate while the project is new/estimated, then approve it. Amount input is in currency units with up to two decimal places; transport and storage use integer cents. The currency starts from saved settings. Approval records the signed-in operator in the browser. Estimates are fixed after approval.

Available actions follow the project state: approved → start; in progress → hold, deliver or cancel; on hold → resume or cancel; new/estimated/approved → cancel; delivered/cancelled → archive. Approval, lifecycle and archive actions require a browser confirmation; dismissing it makes no change. Held projects cannot record new work logs or be delivered. Cancelled projects disappear from the active dashboard but remain linked in client history with their existing records.

POST /projectops/project-requests/:id/control accepts action (start, hold, resume, cancel, deliver, archive) and expectedRevision. Estimate and approval commands accept expectedRevision; browser requests always send it. The older status/estimate/approval API payloads may omit a revision for compatibility, but the repository still checks the revision/state read by that command when writing. Stale commands return 409 and the browser offers Reload project. Generic status writes cannot create estimated/approved states; use the explicit commands that record their metadata. Starting, holding, resuming and delivering require recorded estimate/approval metadata.

Migration 0005 adds on_hold/cancelled to the status constraint without rewriting existing records. Legacy estimated records missing an estimate can be estimated again; legacy approved records missing required metadata cannot start and can be cancelled/archived. Child routes reject ordinary writes to cancelled/archived projects. Planning, execution and delivery commands now enforce their atomic parent guards as described below. Finance child guards and mixed-currency totals remain Slice 10, and automatic activity records remain Slice 11.

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

Slice 9 implementation checkpoint `f0052156c5b0fc5c805538023656a8e60b8357c7` is on `slice-9-delivery-acceptance`, based on `7c006c38f45820d9246c03e68e9865837538115a`. Its completion gate passed locally:

| Command | Result |
| --- | --- |
| `pnpm verify` | 72/72 native tests; 575-file hygiene; zero skips |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:postgres` | 19/19; zero skips |
| `PROJECTOPS_TEST_DATABASE_URL=<configured test database> pnpm test:browser` | 7/7 Chromium journeys; zero skips |

The cloud runs used Node 24.19.0, pnpm 11.19.0, PostgreSQL 16.15 and Playwright Chromium 153.0.8010.12. Test schemas/operators are isolated and cleaned up. The session used `CI=true XDG_DATA_HOME=/tmp/projectops-xdg PNPM_HOME=/tmp/projectops-pnpm` for each command and `PLAYWRIGHT_BROWSERS_PATH=/tmp/projectops-playwright` for the browser command. These external cache paths are environment details, not application settings or repository changes. Set the configured test database URL using the environment; do not put credentials in git. No final failures, skips or database/browser blockers remain.

PostgreSQL acceptance proves create/list/actions and terminal metadata across application restart, defaults/optional relationships, every parent-state restriction, missing/duplicate/constraint classification, unchanged rows after failures, project revision behavior and both delivery/archive readiness rules. Controlled barriers prove exactly one acceptance/addressing winner; cancellation/archival winning against all four commands; hold/delivery winning against submission; child submission/open feedback first blocking delivery; acceptance/addressing first enabling delivery; delivery first permitting later feedback; archival versus post-delivery feedback in both orders; and delivery versus cancellation retaining one project revision winner. Chromium covers the full workflow, all sentiments/source attribution, authenticated addressing, reload persistence, safe text/links, validation and missing relationship feedback, stale terminal actions, zero/submitted/open-feedback delivery blockers, delivered archival rechecking readiness, cancelled archival bypass, all relevant state controls, retained read-only records, independent retries and zero page errors.

Slice 9 awaits independent PR review and has not been merged. Slice 10 is next and has not begun. No deliverable or feedback editing, replacement, versions, rejection, reopening, deletion, uploads, client portal or automatic history is provided. The runtime remains loopback by default and no deployment/final-production-acceptance claim is made.
