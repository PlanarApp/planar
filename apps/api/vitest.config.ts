import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    // `source` reaches eventsource-parser (a dependency of the AI SDK): its source is .ts, which Node refuses to load
    // from node_modules — vite compiles the SDK chain itself
    server: { deps: { inline: [/\/node_modules\/ai\//, /@ai-sdk\//, /eventsource-parser/] } },
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30_000, // seed hashes argon2: under load it takes >5 s
    hookTimeout: 90_000, // afterAll waits for drop database
    maxWorkers: 4,
    sequence: { groupOrder: 1 }, // projects with different maxWorkers need their own group order
    setupFiles: ['./test/file-db.ts'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
