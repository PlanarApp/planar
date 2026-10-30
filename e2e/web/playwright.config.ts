import { defineConfig, devices } from '@playwright/test';

// UI scenarios of web in Chromium against the dev stack (E2E_BASE_URL). Each test creates its own data.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  testIgnore: ['perf/**'],
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    locale: 'ru-RU',
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  },
});
