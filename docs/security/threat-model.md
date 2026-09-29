# Uruk Shift-Left Security Threat Model (STRIDE)

## 1. Trust Boundaries
- **Boundary 1 (External Client -> Reverse Proxy):** Untrusted network traffic. Enforces TLS 1.3 (`EXEC-SEC-031`), header normalization (`EXEC-FOUND-036`), and body size limits (`EXEC-FOUND-037`).
- **Boundary 2 (Reverse Proxy -> `apps/api` / `apps/web`):** Enforces rate limiting (`EXEC-SEC-039`), input schema/range validation (`EXEC-FOUND-049`..`052`), and server/browser trust separation (`EXEC-CLIENT-001`).
- **Boundary 3 (`apps/api` Kernel -> Domain Handlers):** Enforces authentication (`EXEC-SEC-001`), canonical principal resolution (`EXEC-SEC-015`), and deny-by-default RBAC + resource ownership verification (`EXEC-SEC-016`..`021`).
- **Boundary 4 (Application -> PostgreSQL / Redis / Filesystem):** Enforces parameterized SQL (`EXEC-SEC-038`), allowed root path checks (`EXEC-FOUND-028`), and AES-256-GCM field encryption (`EXEC-SEC-034`..`036`).

## 2. STRIDE Mitigation Matrix
| Threat Category | Attack Vector | Execution Graph Control |
|---|---|---|
| **Spoofing** | Forged session cookies or caller-supplied identity headers | `EXEC-SEC-002` (`scrypt` KDF), `EXEC-SEC-003` (256-bit CSPRNG session validation), `EXEC-SEC-015` |
| **Tampering** | SQL injection, path traversal, or audit log modification | `EXEC-SEC-038` (Parameterized SQL), `EXEC-FOUND-028` (Path traversal guard), `EXEC-SEC-045` (HMAC audit chain) |
| **Repudiation** | Unrecorded privileged mutations or secret reads | `EXEC-SEC-027` (Secret access audit), `EXEC-SEC-043`..`045` (Append-only HMAC audit trail) |
| **Information Disclosure** | Stack trace leaks in 5xx responses or secrets in logs | `EXEC-FOUND-046`..`048` (Error normalization), `EXEC-OBS-013` (Telemetry privacy redaction) |
| **Denial of Service** | Connection pool exhaustion, slowloris, or retry storms | `EXEC-FOUND-034` (Timeouts), `EXEC-DB-012` & `014` (Pool bounds & query deadlines), `EXEC-SEC-039` (Rate limiter) |
| **Elevation of Privilege** | Cross-tenant or cross-owner resource mutation | `EXEC-SEC-020` (SQL ownership check), `EXEC-SEC-024` (Escalation prevention) |
