import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'ai-runner', include: ['test/**/*.test.ts'] },
});
