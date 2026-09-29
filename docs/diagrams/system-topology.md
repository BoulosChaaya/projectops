# Uruk System Topology & Diagrams-as-Code

## 1. C4 Container & Trust Boundary Diagram

```mermaid
flowchart TB
  subgraph PublicZone["Untrusted Public Zone"]
    Browser["User Browser / Client"]
  end

  subgraph EdgeZone["DMZ / Reverse Proxy Boundary (infra/tls, infra/reverse-proxy)"]
    Proxy["TLS Termination & Reverse Proxy"]
  end

  subgraph AppZone["Application Runtime Zone (Stateless Processes)"]
    Web["apps/web (server/client rendering boundary)"]
    API["apps/api (HTTP Kernel & Access Control)"]
    Worker["apps/worker (repository-owned queue Job Consumer)"]
  end

  subgraph DataZone["Restricted Data & State Zone"]
    PG[("PostgreSQL 16 (Authoritative State)")]
    Redis[("Redis 7 (Derived Cache & repository-owned queue)")]
  end

  Browser -->|HTTPS / TLS 1.3| Proxy
  Proxy -->|Forwarded Context| Web
  Proxy -->|API Requests| API
  Web -->|Typed HTTP Contract| API
  API -->|Parameterized Raw SQL| PG
  API -->|Raw RESP / repository-owned queue Enqueue| Redis
  Worker -->|Claim & Lock Jobs| Redis
  Worker -->|Transactional Raw SQL| PG
```

## 2. Package Dependency Directed Acyclic Graph (DAG)

```mermaid
flowchart TD
  Web["apps/web"] --> HttpContracts["packages/http-contracts"]
  API["apps/api"] --> Config["packages/config"]
  API --> Logger["packages/logger"]
  API --> Runtime["packages/runtime"]
  API --> HttpContracts
  API --> DB["packages/db"]
  API --> Cache["packages/cache"]
  API --> Queue["packages/queue"]
  API --> Auth["packages/auth"]
  API --> Security["packages/security"]
  API --> Obs["packages/observability"]
  Worker["apps/worker"] --> Config & Logger & Runtime & DB & Queue & Obs
  DB --> Config & Logger & Runtime
  Cache --> Config & Logger
  Queue --> Config & Logger & DB
  Auth --> DB & Security
```

## 3. Runtime Lifecycle State Machine (`EXEC-FOUND-003` & `EXEC-FOUND-017`)

```mermaid
stateDiagram-v2
  [*] --> starting
  starting --> accepting : Dependencies & Listener Ready
  starting --> stopped : Startup Failure (Non-Zero Exit)
  accepting --> draining : SIGTERM / Fatal Fault Signal
  draining --> stopping : In-Flight Requests Completed or Deadline Expired
  stopping --> stopped : Pools & Listeners Closed
  stopped --> [*]
```
