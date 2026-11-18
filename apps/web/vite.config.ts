import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';

// dev and vite preview: /f/<slug> is the separate form.html entry (prod — deploy/Caddyfile)
const toForm: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url?.startsWith('/f/')) req.url = '/form.html';
  next();
};
const formEntry = (): Plugin => ({
  name: 'planar-form-entry',
  configureServer: (s) => void s.middlewares.use(toForm),
  configurePreviewServer: (s) => void s.middlewares.use(toForm),
});

// the public page does not offer to install the app
const noManifest = (): Plugin => ({
  name: 'planar-form-no-manifest',
  enforce: 'post',
  generateBundle(_o, bundle) {
    const f = bundle['form.html'];
    if (f?.type === 'asset') f.source = String(f.source).replace(/<link rel="manifest"[^>]*>/, '');
  },
});

const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    formEntry(),
    noManifest(),
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
        navigateFallbackDenylist: [/^\/(api|sync|ws|files|mcp|collab|f)\//],
      },
    }),
  ],
  resolve: {
    conditions: ['source'],
    // vue-i18n adds ~50 KB gzip to the initial bundle (WB-13); vitest.config.ts uses the same alias, so prod and tests share one implementation.
    alias: { 'vue-i18n': fileURLToPath(new URL('./src/i18n/lite.ts', import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        form: fileURLToPath(new URL('./form.html', import.meta.url)),
      },
      output: {
        // otherwise the vue wrapper lands in the lazy reka chunk and pulls it into the initial bundle (WB-13)
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
