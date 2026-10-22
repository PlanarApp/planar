import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    conditions: ['source'],
    // node-окружение тестов не видит условие `source`
    alias: {
      '@planar/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
});
