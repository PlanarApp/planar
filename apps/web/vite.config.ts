import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
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
        navigateFallbackDenylist: [/^\/(api|sync|ws|files|mcp)\//],
      },
    }),
  ],
  resolve: {
    conditions: ['source'],
    // vue-i18n весит ~50 КБ gzip в начальном бандле (WB-13); vitest.config.ts — тот же alias, прод и тесты на одной реализации.
    alias: { 'vue-i18n': fileURLToPath(new URL('./src/i18n/lite.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/sync': target,
      '/ws': { target, ws: true },
      '/files': target,
      '/mcp': target,
    },
  },
});
