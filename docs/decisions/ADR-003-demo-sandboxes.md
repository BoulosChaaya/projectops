# Public demo: a private sandbox per visitor, in its own PostgreSQL schema

Status: accepted by the owner on 2026-10-16 (Phase 5, showcase).

## Context

ProjectOps is a portfolio project with one operator account. Visitors (recruiters, reviewers) should be able to use it without credentials, and see it with realistic data. Everything a visitor does must be invisible to the owner and to other visitors, and must not put the owner's data at risk.

Options considered:

- **Read-only showcase.** One shared seeded dataset; every write refused. Small and safe, but a visitor cannot try anything, so it shows little more than screenshots.
- **Separate demo deployment.** A second service and database with public credentials and a nightly reset. Visitors share one dataset (anything one types is seen by the next), and it roughly doubles the hosting cost.
- **A private sandbox per visitor, in the same deployment.** Chosen.

## Decision

- "Explore the demo" on the sign-in page creates a schema `demo_<24 hex>`, runs the ordinary migrations into it, and seeds a fictional studio through the repository's own commands (so the data obeys every business rule and the history is real). The visitor gets a session for that sandbox only.
- Every query for a demo session runs as `BEGIN; set_config('search_path', <sandbox>, true); …; COMMIT`. The setting lives only for that transaction, so it cannot outlive it on a pooled connection, and the main schema is not on the path: a table missing from the sandbox is an error, never a fall-back to the owner's data. Building a sandbox uses a dedicated connection, closed afterwards.
- All application SQL names tables without a schema, which is what makes this possible without changing any query. New SQL must keep doing so.
- Demo tokens carry a `demo.` prefix; operator tokens are exactly 43 characters. Neither store accepts the other's tokens. A request marked as a sandbox is never served the main data, even if sandbox support is missing (it fails instead).
- `projectops_demo_sandboxes`, in the main schema, records each sandbox and its expiry. Sandboxes live two hours from their start (resets do not extend it); "Leave demo" deletes the sandbox's data at once but keeps its record (expired) until it leaves the rate window, so leaving does not reset the limit; a sweeper drops expired ones, unfinished builds and demo schemas without a row. Limits are global (30 alive, 20 new per 10 minutes), because a client IP behind the host's proxy cannot be trusted. Each sandbox may also make 60 changes a minute and 500 in total until reset: sandboxes share the owner's disk, and without that budget one script filled 1 GB in about 18 minutes in a local measurement.
- In a sandbox, settings are the visitor's own (the timezone starts as the visitor's browser timezone), and sign-in credentials cannot be changed.
- Backups exclude sandbox schemas and the sandbox registry's rows; the backup fingerprint ignores them too, so a visitor arriving mid-backup cannot fail it.
- The demo is switched on by `PROJECTOPS_DEMO=on` (on in `render.yaml`); `off` or unset removes the offer and refuses demo tokens.

## Consequences

- One database holds the owner's data and up to 30 small schemas (about 1 MB each, measured with the seed and indexes), well within the 1 GB disk.
- A sandbox takes about 0.35 s to build locally (about 500 statements: the migrations, then the seed in one transaction). On the host, with a network hop per statement, expect a second or two; the sign-in page says it is preparing the sandbox meanwhile.
- Isolation rests on the search path and on schema-free SQL, so both are tested directly: a demo session sees none of the owner's data and the owner none of the sandbox; a pooled connection never keeps a sandbox's search path; the main schema's tables are unreachable from a sandbox. Removing either guard fails those tests.
- One ProjectOps deployment per database: the sweeper treats every `demo_<24 hex>` schema in the database as its own.
