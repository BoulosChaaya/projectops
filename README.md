# ProjectOps

ProjectOps is a client and project operations product built on the Uruk foundation.

It uses Uruk's dependency-light TypeScript structure to prove real product behavior through raw platform primitives, explicit boundaries, and verification. The first product slice focuses on clients, project requests, workflow state, dashboard visibility, raw SQL persistence, and tests.

## Principles

- Keep third-party runtime dependencies near zero.
- Prefer Node.js and Web Platform primitives before adding frameworks.
- Keep persistence, caching, queueing, security, observability, and release behavior behind owned boundaries.
- Treat documentation as project guidance, not generated tooling output.
- Verify behavior with Node's built-in test runner.

## Project Definition

Start with [What Uruk Is](docs/what-uruk-is.md) for the foundation rules. Product behavior belongs in clearly named ProjectOps application and package boundaries instead of leaking into reusable Uruk primitives.

## Repository Layout

```text
apps/          runnable application boundaries
packages/      reusable foundation packages
infra/         production infrastructure contracts and policies
tests/         native TypeScript verification suites
docs/          architecture, decisions, operations, and execution graph notes
scripts/       project verification scripts
```

## Commands

```bash
pnpm test
pnpm verify
```

`pnpm verify` checks repository hygiene and runs the native TypeScript test suites.
