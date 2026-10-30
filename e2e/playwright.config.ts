import { defineConfig } from '@playwright/test';

// API tests only (request context and ws): browsers are not needed. Tests in the file run in order on shared data.
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
