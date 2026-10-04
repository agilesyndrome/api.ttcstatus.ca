import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Vite has no publicDir: expose only the archived game's own static files. */
export function legacySnakeMiddleware(request, response, next) {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/snake/v1') {
    response.writeHead(308, { location: '/snake/v1/' }); response.end(); return;
  }
  if (!pathname.startsWith('/snake/v1/')) return next();
  const filename = pathname.slice('/snake/v1/'.length) || 'index.html';
  const files = { 'index.html': 'text/html', 'game.js': 'text/javascript', 'styles.css': 'text/css',
    'site.webmanifest': 'application/manifest+json', 'icon.png': 'image/png', 'apple-touch-icon.png': 'image/png' };
  if (!files[filename] || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
  void readFile(resolve('public/snake/v1', filename)).then(content => {
    response.writeHead(200, { 'content-type': files[filename], 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  }).catch(() => { response.writeHead(404); response.end(); });
}
