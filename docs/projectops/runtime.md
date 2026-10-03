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

Deadline inputs explicitly use UTC; displayed dates use the operator's saved IANA timezone. API deadlines remain ISO instants and cannot precede project creation. Forms reject invalid input and offer a deliberate reload on 409 conflicts. Planning/execution/delivery/finance editing controls and automatic history remain their later approved slices; this workspace connects their current records.

## Estimates and project controls

The workspace lets the operator save or revise an estimate while the project is new/estimated, then approve it. Amount input is in currency units with up to two decimal places; transport and storage use integer cents. The currency starts from saved settings. Approval records the signed-in operator in the browser. Estimates are fixed after approval.

Available actions follow the project state: approved → start; in progress → hold, deliver or cancel; on hold → resume or cancel; new/estimated/approved → cancel; delivered/cancelled → archive. Approval, lifecycle and archive actions require a browser confirmation; dismissing it makes no change. Held projects cannot record new work logs or be delivered. Cancelled projects disappear from the active dashboard but remain linked in client history with their existing records.

POST /projectops/project-requests/:id/control accepts action (start, hold, resume, cancel, deliver, archive) and expectedRevision. Estimate and approval commands accept expectedRevision; browser requests always send it. The older status/estimate/approval API payloads may omit a revision for compatibility, but the repository still checks the revision/state read by that command when writing. Stale commands return 409 and the browser offers Reload project. Generic status writes cannot create estimated/approved states; use the explicit commands that record their metadata. Starting, holding, resuming and delivering require recorded estimate/approval metadata.

Migration 0005 adds on_hold/cancelled to the status constraint without rewriting existing records. Legacy estimated records missing an estimate can be estimated again; legacy approved records missing required metadata cannot start and can be cancelled/archived. Child routes reject ordinary writes to cancelled/archived projects. Atomic concurrency guards for child collection commands, including a child write racing cancellation, belong to the planning/execution/delivery/finances slices. Delivery acceptance/completion gates are slice 9, mixed-currency totals slice 10, and automatic activity records slice 11.
