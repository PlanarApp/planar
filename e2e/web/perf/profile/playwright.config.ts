import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});
