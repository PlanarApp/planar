import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [vue()],
  resolve: { conditions: ['source'] },
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
