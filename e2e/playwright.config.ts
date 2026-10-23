import { defineConfig } from '@playwright/test';

// Только API-тесты (request-контекст и ws): браузеры не нужны. Тесты файла идут по порядку на общих данных.
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
});
