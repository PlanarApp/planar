import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000, // seed хэширует argon2: под нагрузкой >5 с
    hookTimeout: 90_000, // afterAll дожидается drop database
    maxWorkers: 4,
    sequence: { groupOrder: 1 }, // у проектов с разным maxWorkers должен быть свой порядок группы
    setupFiles: ['./test/file-db.ts'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
