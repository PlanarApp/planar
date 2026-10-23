import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    conditions: ['source'],
    // node-окружение тестов не видит условие `source`
    alias: {
      // как в проде (vite.config.ts): тесты идут на той же реализации i18n
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
