import { readProjectOpsRuntimeConfig, startProjectOpsPostgresApp } from './postgres-app.ts';

try {
  const app = await startProjectOpsPostgresApp(readProjectOpsRuntimeConfig());
  const shutdown = () => {
    app.close().catch(() => {
      console.error('ProjectOps shutdown failed.');
      process.exitCode = 1;
    });
  };
  // Install the handlers before announcing readiness: a supervisor (or test) that reacts to this
  // line with SIGTERM must reach the graceful shutdown, not Node's default immediate exit.
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.log(`ProjectOps listening at ${app.server.origin}`);
} catch {
  console.error('ProjectOps startup failed. Check database configuration and migration compatibility.');
  process.exitCode = 1;
}
