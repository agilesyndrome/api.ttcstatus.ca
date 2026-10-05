import { renderLocalizedHtml } from './scripts/i18n/html.mjs';
import { buildClassicAssets } from './scripts/build/build-classic.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { legacySnakeMiddleware } from './scripts/preview/legacy-snake.mjs';
import { createPreviewMiddleware } from './scripts/preview/preview-api.mjs';

export default defineConfig({
  root: resolve('web/ui'),
  publicDir: resolve('public'),
  plugins: [
    react(),
    {
      name: 'ttc-localized-copy',
      transformIndexHtml: { order: 'pre', handler: renderLocalizedHtml },
      async generateBundle() {
        for (const [fileName, source] of Object.entries(await buildClassicAssets()))
          this.emitFile({ type: 'asset', fileName: `snake/v1/${fileName}`, source });
      },
    },
    {
      name: 'ttc-local-api',
      apply: 'serve',
      async configureServer(server) {
        server.middlewares.use(legacySnakeMiddleware);
        server.middlewares.use(await createPreviewMiddleware());
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: resolve('dist'), emptyOutDir: true },
});
