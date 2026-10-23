import { defineConfig } from '@playwright/test';

// Замеры бюджетов §7 в настоящем Chromium; пороги проверяет приёмка по числам, не тест.
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});
