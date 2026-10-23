import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000, // seed хэширует argon2: под нагрузкой >5 с
    hookTimeout: 30_000,
    setupFiles: ['./test/file-db.ts'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
