import { defineConfig } from '@playwright/test';

// Measurements of §7 budgets in real Chromium; thresholds are checked by acceptance on the numbers, not by the test.
export default defineConfig({
  testDir: '.',
  testIgnore: ['profile/**'],
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});
