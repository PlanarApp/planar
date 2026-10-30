import { defineConfig } from '@playwright/test';

// Smoke test of the prod stack via Caddy (E2E_BASE_URL); request context only, browsers are not needed.
export default defineConfig({
  testDir: '.',
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
