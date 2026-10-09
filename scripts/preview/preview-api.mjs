import { build } from 'esbuild';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewMap } from './preview-map.mjs';

/** Local API adapter only; production acquisition stays in the Worker. */
export async function createPreviewMiddleware() {
  const compiled = await build({
    stdin: {
      contents: `
    export { DEFAULT_VEHICLE_FEED_URL, fetchRailSnapshot } from './workers/api/src/realtime/realtime';
    export { VehicleSnapshotCache } from './workers/api/src/realtime/vehicle-snapshot-cache';
    export { liveUpdateSeconds } from './shared/live/config';
    export { ifNoneMatchMatches } from './shared/http/etag';
    export { buildViewerData } from './shared/map/model';
    export { buildSnakeMap } from './shared/map/game-map';`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  await mkdir('.wrangler/preview', { recursive: true });
  await writeFile('.wrangler/preview/react-realtime.mjs', compiled.outputFiles[0].text);
  const {
    VehicleSnapshotCache,
    fetchRailSnapshot,
    DEFAULT_VEHICLE_FEED_URL,
    liveUpdateSeconds,
    ifNoneMatchMatches,
    buildViewerData,
    buildSnakeMap,
  } = await import(pathToFileURL(resolve('.wrangler/preview/react-realtime.mjs')).href);
  const updateSeconds = liveUpdateSeconds(process.env.REALTIME_UPDATE_SECONDS);
  const snapshots = new VehicleSnapshotCache(
    DEFAULT_VEHICLE_FEED_URL,
    'Contains information licensed under the Open Government Licence - Toronto',
    updateSeconds,
    fetchRailSnapshot,
  );
  let sourcePromise;
  return async (request, response, next) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith('/api/')) return next();
    const json = (value, status = 200, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(value));
    };
    // Use Wrangler for Clerk sessions and D1 account data; this preview has no auth secrets.
    if (request.method === 'GET' && path === '/api/v1/auth/config')
      return json({ enabled: false, publishableKey: null }, 200, {
        'cache-control': 'no-store',
      });
    if (path.startsWith('/api/v1/me/'))
      return json({ error: 'auth-unavailable' }, 503, { 'cache-control': 'no-store' });
    if (path.startsWith('/api/v1/profiles/'))
      return json({ error: 'profile-not-found' }, 404, { 'cache-control': 'no-store' });
    if (request.method !== 'GET') return json({ error: 'not-found' }, 404);
    if (path === '/api/healthz') return json({ ok: true, worker: 'local-preview' });
    if (path === '/api/v1/version')
      return json(
        {
          site: 'ttcstatus.ca',
          source: 'https://github.com/agilesyndrome/api.ttcstatus.ca',
          deploy: null,
        },
        200,
        { 'cache-control': 'no-store' },
      );
    if (
      path === '/api/v1/map/streetcar' ||
      path === '/api/v1/map/snake' ||
      path === '/api/v1/map/ttcstatus'
    ) {
      try {
        // Cache the source bundle; the snake board is derived per request so
        // one cached promise can serve every named map.
        sourcePromise ??= (async () =>
          previewMap(
            process.env.MAP_INPUT ||
              (await access('.wrangler/preview/rail-map.json').then(
                () => '.wrangler/preview/rail-map.json',
                () => 'data/fixtures/streetcarmap.json',
              )),
          ))().catch((error) => {
          sourcePromise = undefined;
          throw error;
        });
        const source = await sourcePromise;
        if (path !== '/api/v1/map/streetcar') {
          // Derive the published board exactly like the generator does: the
          // snake game and the stable ttcstatus site map share one payload.
          return json(buildSnakeMap(buildViewerData(source)).data, 200, {
            'cache-control': 'public, max-age=3600',
          });
        }
        return json(source, 200, { 'cache-control': 'public, max-age=3600' });
      } catch (error) {
        console.error(error);
        return json({ error: 'map-not-ready' }, 503);
      }
    }
    if (path === '/api/v1/vehicles/streetcar') {
      try {
        const value = await snapshots.get();
        const headers = {
          'cache-control': 'no-store',
          etag: value.etag,
          'x-live-update-seconds': String(updateSeconds),
          'x-live-next-update-at': new Date(value.nextUpdateAt).toISOString(),
        };
        if (ifNoneMatchMatches(request.headers['if-none-match'], value.etag)) {
          response.writeHead(304, headers);
          return response.end();
        }
        return json(value.snapshot, 200, headers);
      } catch (error) {
        console.error('Live preview snapshot failed', error);
        return json({ error: 'vehicles-unavailable' }, 503, {
          'cache-control': 'no-store',
          'x-live-update-seconds': String(updateSeconds),
          'retry-after': String(updateSeconds),
        });
      }
    }
    return json({ error: 'not-found' }, 404);
  };
}
