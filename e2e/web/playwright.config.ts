import { defineConfig, devices } from '@playwright/test';

// UI-сценарии web в Chromium против dev-стека (E2E_BASE_URL). Каждый тест создаёт свои данные.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
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
