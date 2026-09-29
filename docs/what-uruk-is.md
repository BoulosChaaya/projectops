# What Uruk Is

Uruk is a production-grade TypeScript foundation for building small, medium, and large systems with owned platform primitives instead of framework lock-in.

It is not an application, a generated template dump, or a framework clone. It is the base layer a real product can grow from: HTTP boundaries, worker boundaries, persistence contracts, queueing contracts, caching behavior, security primitives, observability, release checks, infrastructure policies, and verification.

## Purpose

Uruk exists to make serious project work start from explicit engineering decisions:

- use raw Node.js, TypeScript, and Web Platform primitives by default;
- keep third-party runtime dependencies near zero;
- define clear boundaries before adding product behavior;
- keep infrastructure, operations, security, and testing visible from the beginning;
- make every added capability verifiable.

## What Belongs Here

Uruk should contain reusable foundation code and documents that help future projects stay disciplined:

- application boundaries under `apps/`;
- shared foundation packages under `packages/`;
- infrastructure contracts and operational policy under `infra/`;
- architecture, decision, operations, security, VCS, and execution graph notes under `docs/`;
- verification suites under `tests/`;
- small project verification scripts under `scripts/`.

New code belongs here only when it strengthens the foundation or proves how a product should use it. Product-specific behavior should live in a clearly named app or package instead of leaking into shared primitives.

## What Does Not Belong Here

Uruk should not accumulate:

- generated salvage output;
- archived experiments;
- unowned tooling;
- framework scaffolding that is not part of an accepted decision;
- dependency-heavy shortcuts;
- vague placeholder docs that do not guide implementation;
- product features without a verification path.

## Dependency Posture

The default answer to a new dependency is no until the codebase proves it needs one.

Accept a dependency only when it solves a real problem better than an owned primitive, has a clear boundary, and does not quietly take over persistence, authentication, observability, queueing, or runtime control.

## Branch Naming

The canonical long-lived branch name for Uruk is `main`.

`main` is the engineering default because it matches modern repository conventions, avoids legacy naming baggage, and reduces friction with hosting, examples, documentation, and contributors.

## How Work Should Be Added

Add work in small, reviewable increments:

1. Name the boundary being changed.
2. Add or update the contract.
3. Add focused verification.
4. Keep dependencies explicit.
5. Update the relevant documentation.

Uruk should stay clean enough that a future project can start from it without first removing old experiments, unclear names, or accidental tooling.
