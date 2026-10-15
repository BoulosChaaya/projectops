# ProjectOps web client: React, built by Vite, served from the same origin

Status: accepted by the owner on 2026-10-15 (Phase 4, option B).

## Context

The browser pages were server-rendered HTML with browser JavaScript written inside TypeScript template strings (about 110 KB). They work and are covered by Chromium journeys, but the interface had grown hard to use (an 18-card dashboard whose figures overflow, a single long project page with 17 anchor links) and the code is hard to extend or review as frontend work. The JSON API behind them is already a stable contract: camelCase domain objects, keyset pagination, typed errors, sessions with Origin and CSRF checks.

Options considered:

- **Redesign the server-rendered pages with vanilla JavaScript.** Cheapest; no build step or new dependencies. It improves the look but not the structure of the frontend code.
- **React single-page client built by Vite, served by the existing Node server.** Chosen.
- **Next.js.** Next owns its own server. Either it replaces the hand-built Node server, which is the point of this project, or it runs as a second service, which adds cost and moves the session cookie and CSRF protection to a cross-origin setup. Rejected.

## Decision

- The client lives in `apps/client` (React 19, TypeScript, Vite). `pnpm build` writes `apps/client/dist`.
- The API server serves it from the same origin: `index.html` for each migrated page and hashed files under `/projectops/assets/`. The session cookie, Origin check and CSRF token work unchanged; the client is just another same-origin caller of the JSON API.
- The page CSP allows scripts, styles and fonts from the same origin only (`script-src 'self'`, no inline code, no remote hosts). The build never inlines files as `data:` URIs.
- Pages move one area at a time. A migrated path is served the client; every other path stays a server-rendered page, reached by an ordinary link. Each step is a separate pull request and each merge deploys a working application.
- React, Vite, the Vite React plugin, React type definitions and the IBM Plex Sans font files are **build-time** dependencies (devDependencies, exact versions, frozen lockfile). They are compiled into static files; the server's only runtime dependency is still `pg`. Render installs everything, builds, then reinstalls production dependencies only.
- No client-side state or routing library, CSS framework or component kit. The client has a small typed API module (`apps/client/src/api.ts`) and hand-written CSS on design tokens (`apps/client/src/styles/tokens.css`). Adding a library is a new decision.

## Consequences

- The build step is part of `pnpm verify`, CI and the Render build. Browser suites need a built client; native server tests use a small fixture client so they do not.
- While pages migrate, the interface mixes two styles. Migrated pages link back to server-rendered ones and the reverse.
- Browser tests keep finding controls by their visible labels and roles, so the same journeys verify the old and the new pages.
- Hashed assets are currently sent with the application's `Cache-Control: no-store` policy like every other response. Long-lived caching for them is a later, separate change to that policy.
