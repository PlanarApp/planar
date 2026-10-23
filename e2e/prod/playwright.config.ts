import { defineConfig } from '@playwright/test';

// Смоук prod-стека через Caddy (E2E_BASE_URL); только request-контекст, браузеры не нужны.
export default defineConfig({
  testDir: '.',
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
