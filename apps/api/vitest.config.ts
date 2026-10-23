import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    testTimeout: 30_000,
    // seed.test считает все строки общей БД; параллельные файлы с пользователями ему мешают
    fileParallelism: false,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
