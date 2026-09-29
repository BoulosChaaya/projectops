# ADR-011: Rendering Strategy Selection per Route Class

- **Execution Graph Node:** `EXEC-CLIENT-012`
- **Status:** Accepted

## Decision
Select rendering strategy deterministically by route class: Build-Time Static (`EXEC-CLIENT-013`) for public immutable pages, Request-Time Server Rendering (`EXEC-CLIENT-014`) for authenticated/personalized views, and Client-Time (`EXEC-CLIENT-015`) strictly inside interactive islands.

## Rejected Alternatives
Fetching sensitive data from the browser with exposed tokens or marking authenticated HTML responses as publicly cacheable (`EXEC-CLIENT-020`).

## Consequences & Enforcement
`RenderingStrategy` governs route-level rendering and cache headers.
