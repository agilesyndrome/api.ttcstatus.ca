import { createHash } from 'node:crypto';

/** Only public app assets are precached. Transit and account JSON use their own stores. */
export function appServiceWorker(files) {
  const resources = [
    '/index.html',
    ...files
      .filter((name) => name.startsWith('assets/') && /\.(js|css)$/.test(name))
      .map((name) => `/${name}`),
  ].sort();
  const revision = createHash('sha256')
    .update(JSON.stringify(resources))
    .digest('hex')
    .slice(0, 16);
  return `// Generated from the build manifest; activation waits for old tabs to close.
const CACHE = ${JSON.stringify(`ttc-ui-${revision}`)};
const RESOURCES = ${JSON.stringify(resources)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(RESOURCES)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('ttc-ui-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const appPage = event.request.mode === 'navigate' && (/^\\/(settings|profile|sla|snake(?:\\/v2)?)?\\/?$/.test(url.pathname) || /^\\/u\\/[^/]+$/.test(url.pathname));
  if (!appPage && !RESOURCES.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(appPage ? '/index.html' : url.pathname);
    return cached || fetch(event.request);
  }));
});
`;
}
