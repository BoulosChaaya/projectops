// Render's generated HTTPS URL is the trusted configured public origin, never a forwarded header.
process.env.PUBLIC_ORIGIN ??= process.env.RENDER_EXTERNAL_URL;
await import('../apps/api/src/projectops/main.ts');
