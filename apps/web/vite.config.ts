import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// dev: /f/<slug> — отдельный вход form.html (prod — deploy/Caddyfile)
const formEntry = (): Plugin => ({
  name: 'planar-form-entry',
  configureServer: (s) =>
    void s.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/f/')) req.url = '/form.html';
      next();
    }),
});

const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    formEntry(),
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Planar',
        short_name: 'Planar',
        start_url: '/',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(api|sync|ws|files|mcp|f)\//],
      },
    }),
  ],
  resolve: {
    conditions: ['source'],
    // vue-i18n весит ~50 КБ gzip в начальном бандле (WB-13); vitest.config.ts — тот же alias, прод и тесты на одной реализации.
    alias: { 'vue-i18n': fileURLToPath(new URL('./src/i18n/lite.ts', import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        form: fileURLToPath(new URL('./form.html', import.meta.url)),
      },
      output: {
        // vue-обёртка иначе оседает в ленивом reka-чанке и тащит его в начальный бандл (WB-13)
        codeSplitting: {
          groups: [
            { name: 'vue', test: /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(vue|@vue)\// },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/sync': target,
      '/ws': { target, ws: true },
      '/collab': { target, ws: true },
      '/files': target,
      '/mcp': target,
    },
  },
});
