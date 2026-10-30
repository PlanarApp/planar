import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    conditions: ['source'],
    // the node test environment does not see the `source` condition
    alias: {
      // as in prod (vite.config.ts): tests use the same i18n implementation
      'vue-i18n': fileURLToPath(new URL('./src/i18n/lite.ts', import.meta.url)),
      '@planar/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', '../../modules/*/web/**/*.test.ts'],
  },
});
