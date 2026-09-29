# ADR-010: Security Privilege Boundaries and Zero-Trust Elevation

- **Execution Graph Node:** `EXEC-SEC-022`
- **Status:** Accepted

## Decision
Enforce four strict privilege zones (`anonymous`, `authenticated_principal`, `scoped_tenant_member`, `system_operator`). Every protected route requires both role permission evaluation (`EXEC-SEC-018`) and authoritative SQL resource ownership/scope verification (`EXEC-SEC-020`, `023`).

## Rejected Alternatives
Trusting client-supplied `userId`/`tenantId` body parameters or granting global admin bypasses without audit logging (`EXEC-SEC-043`).

## Consequences & Enforcement
`PrivilegeBoundary` codifies allowed transitions and prevents horizontal/vertical privilege escalation (`EXEC-SEC-024`).
