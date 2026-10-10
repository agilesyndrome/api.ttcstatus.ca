import { renderLocalizedHtml } from './scripts/i18n/html.mjs';
import { buildClassicAssets } from './scripts/build/build-classic.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legacySnakeMiddleware } from './scripts/preview/legacy-snake.mjs';
import { createPreviewMiddleware } from './scripts/preview/preview-api.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
/** Cloudflare Workers Builds injects WORKERS_CI_COMMIT_SHA; local builds read
 * the Git checkout. Both embed the exact commit the bundle was built from. */
const commit =
  process.env.WORKERS_CI_COMMIT_SHA ||
  (() => {
    try {
      return execSync('git rev-parse HEAD').toString().trim();
    } catch {
      return '';
    }
  })();
const sourceUrl =
  typeof pkg.repository?.url === 'string'
    ? pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
    : 'https://github.com/agilesyndrome/api.ttcstatus.ca';

export default defineConfig({
  root: resolve('web/ui'),
  publicDir: resolve('public'),
  define: {
    __SITE_VERSION__: JSON.stringify(pkg.version),
    __SITE_COMMIT__: JSON.stringify(commit),
    __SITE_COMMIT_SHORT__: JSON.stringify(commit.slice(0, 7)),
    __SITE_SOURCE_URL__: JSON.stringify(sourceUrl),
  },
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
  server: {
    host: process.env.UI_HOST || '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: { outDir: resolve('dist'), emptyOutDir: true },
});
