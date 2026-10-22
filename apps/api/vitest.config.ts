import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
