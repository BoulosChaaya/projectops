# Engineering Execution Graph

This directory keeps Uruk's engineering execution graph as documentation. It is no longer tied to a generator, checksum bundle, or machine-source layer.

Use these files as a navigation map for implementation order, architectural pressure, and verification coverage. The source of truth for working behavior is the repository code and `pnpm verify`.

**Documented execution nodes:** 428

## Full-stack execution path

```mermaid
flowchart LR
  FOUND["FOUND · Runtime & HTTP Foundation"]
  DB["DB · Persistence"]
  FOUND --> DB
  CACHE["CACHE · Caching"]
  DB --> CACHE
  QUEUE["QUEUE · Asynchronous Job Processing"]
  CACHE --> QUEUE
  SEC["SEC · Security & Identity"]
  QUEUE --> SEC
  CLIENT["CLIENT · Client Interface"]
  SEC --> CLIENT
  OBS["OBS · Observability"]
  CLIENT --> OBS
  TEST["TEST · Testing"]
  OBS --> TEST
  CICD["CICD · CI/CD"]
  TEST --> CICD
  OPS["OPS · Production Operations"]
  CICD --> OPS
  ARCH["ARCH · Distributed Systems"]
  OPS --> ARCH
```

## Layers

| Layer | Nodes | Global range | Activation |
|---|---:|---:|---|
| [FOUND — Runtime & HTTP Foundation](./found.md) | 60 | 1–60 | Foundational / lifecycle |
| [DB — Persistence](./db.md) | 61 | 61–121 | Persistence Required |
| [CACHE — Caching](./cache.md) | 18 | 122–139 | High Read Latency |
| [QUEUE — Asynchronous Job Processing](./queue.md) | 39 | 140–178 | Deferred Execution Required |
| [SEC — Security & Identity](./sec.md) | 46 | 179–224 | Multiple Users Exist |
| [CLIENT — Client Interface](./client.md) | 26 | 225–250 | System Becomes User-Facing |
| [OBS — Observability](./obs.md) | 31 | 251–281 | System Behavior Becomes Opaque |
| [TEST — Testing](./test.md) | 26 | 282–307 | Manual Verification No Longer Scales |
| [CICD — CI/CD](./cicd.md) | 44 | 308–351 | Foundational / lifecycle |
| [OPS — Production Operations](./ops.md) | 36 | 352–387 | Deployments Are Automated and Observable |
| [ARCH — Distributed Systems](./arch.md) | 41 | 388–428 | Single Service Boundary No Longer Sufficient |

## Repository shape

```text
apps/
  web/
  api/
  worker/
  gateway/
packages/
  runtime/
  db/
  cache/
  queue/
  auth/
  security/
  http-contracts/
  observability/
  testing-kit/
  resilience/
  events/
  tenancy/
infra/
docs/
  execution-graph/
```
