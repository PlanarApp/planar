import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// the app version for the sidebar button — the newest release of CHANGELOG.md (About shows the whole history)
const appVersion =
  /^## \[(\d[^\]]*)\]/m.exec(
    readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'),
  )?.[1] ?? '';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
