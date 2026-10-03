# ProjectOps PostgreSQL transport

The approved durable-runtime slice requires a real PostgreSQL connection. URUK owns raw SQL contracts but does not implement a production PostgreSQL wire driver.

Use the pinned pg package solely as the transport adapter in the ProjectOps application. Domain logic, SQL, repositories and migrations remain owned code; no ORM is introduced. Reimplementing PostgreSQL authentication, protocol framing and TLS would add unrelated work and risk. This is the deliberate dependency decision required by AI_CONTEXT.md. URUK itself is not modified.

The application uses a bounded connection pool. Migration work uses one checked-out connection, a PostgreSQL advisory transaction lock, a persistent checksum ledger and a transaction covering DDL plus ledger writes. Unknown, modified or out-of-order migration history fails startup. Unmanaged legacy schemas are refused rather than silently adopted.

The SQL artifact 0001_projectops_foundation.sql is the frozen baseline for newly managed databases. Future schema changes must be new migration artifacts and registered in the PostgreSQL migration list. Existing memory migration helpers remain available for native contract tests.
