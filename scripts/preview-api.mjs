import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewMap } from './preview-map.mjs';

/** Local API adapter only; production acquisition stays in the Worker. */
export async function createPreviewMiddleware() {
  const compiled = await build({ stdin: { contents: `
    export { DEFAULT_VEHICLE_FEED_URL } from './workers/api/src/realtime';
    export { VehicleSnapshotCache } from './workers/api/src/vehicle-snapshot-cache';
    export { liveUpdateSeconds } from './workers/shared/live-config';
    export { ifNoneMatchMatches } from './workers/shared/etag';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
  await mkdir('.wrangler/preview', { recursive: true });
  await writeFile('.wrangler/preview/react-realtime.mjs', compiled.outputFiles[0].text);
  const { VehicleSnapshotCache, DEFAULT_VEHICLE_FEED_URL, liveUpdateSeconds, ifNoneMatchMatches } = await import(pathToFileURL(resolve('.wrangler/preview/react-realtime.mjs')).href);
  const updateSeconds = liveUpdateSeconds(process.env.REALTIME_UPDATE_SECONDS);
  const snapshots = new VehicleSnapshotCache(DEFAULT_VEHICLE_FEED_URL,
    'Contains information licensed under the Open Government Licence - Toronto', updateSeconds);
  let mapPromise;
  return async (request, response, next) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return next();
    const json = (value, status = 200, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value)); };
    // Use Wrangler for Clerk sessions and D1 account data; this preview has no auth secrets.
    if (request.method === 'GET' && path === '/api/v1/auth/config') return json({ enabled: false, publishableKey: null }, 200, { 'cache-control': 'no-store' });
    if (path.startsWith('/api/v1/me/')) return json({ error: 'auth-unavailable' }, 503, { 'cache-control': 'no-store' });
    if (path.startsWith('/api/v1/profiles/')) return json({ error: 'profile-not-found' }, 404, { 'cache-control': 'no-store' });
    if (request.method !== 'GET') return json({ error: 'not-found' }, 404);
    if (path === '/api/healthz') return json({ ok: true, worker: 'local-preview' });
    if (path === '/api/v1/map/streetcar') {
      try {
        mapPromise ??= (async () => { const dir = await mkdtemp(join(tmpdir(), 'ttc-react-preview-')); return previewMap('streetcarmap.json', join(dir, 'map.json'), join(dir, 'map.svg'), join(dir, 'map.html')); })().catch(error => { mapPromise = undefined; throw error; });
        return json(await mapPromise, 200, { 'cache-control': 'public, max-age=3600' });
      } catch (error) { console.error(error); return json({ error: 'map-not-ready' }, 503); }
    }
    if (path === '/api/v1/vehicles/streetcar') {
      try {
        const value = await snapshots.get();
        const headers = { 'cache-control': 'no-store', etag: value.etag, 'x-live-update-seconds': String(updateSeconds), 'x-live-next-update-at': new Date(value.nextUpdateAt).toISOString() };
        if (ifNoneMatchMatches(request.headers['if-none-match'], value.etag)) { response.writeHead(304, headers); return response.end(); }
        return json(value.snapshot, 200, headers);
      } catch (error) { console.error('Live preview snapshot failed', error); return json({ error: 'vehicles-unavailable' }, 503, { 'cache-control': 'no-store', 'x-live-update-seconds': String(updateSeconds), 'retry-after': String(updateSeconds) }); }
    }
    return json({ error: 'not-found' }, 404);
  };
}
