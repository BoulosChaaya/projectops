import { readProjectOpsRuntimeConfig, startProjectOpsPostgresApp } from './postgres-app.ts';

try {
  const app = await startProjectOpsPostgresApp(readProjectOpsRuntimeConfig());
  console.log(`ProjectOps listening at ${app.server.origin}`);
  const shutdown = () => {
    app.close().catch(() => {
      console.error('ProjectOps shutdown failed.');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  console.error('ProjectOps startup failed. Check database configuration and migration compatibility.');
  process.exitCode = 1;
}
