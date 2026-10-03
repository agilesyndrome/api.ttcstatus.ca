import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createPreviewMiddleware } from './scripts/preview-api.mjs';

export default defineConfig({
  root: resolve('web/ui'),
  publicDir: false,
  plugins: [react(), {
    name: 'ttc-local-api',
    apply: 'serve',
    async configureServer(server) { server.middlewares.use(await createPreviewMiddleware()); },
  }],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: resolve('public'), emptyOutDir: false },
});
