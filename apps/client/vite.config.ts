import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server serves this build from the same origin: index.html for client-rendered pages
// and hashed files under /projectops/assets/. Same origin keeps the session cookie, Origin check
// and CSRF token exactly as they are for the server-rendered pages.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/projectops/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // Never inline files as data: URIs; the page CSP allows only same-origin scripts, styles and fonts.
    assetsInlineLimit: 0,
    target: 'es2022',
  },
});
