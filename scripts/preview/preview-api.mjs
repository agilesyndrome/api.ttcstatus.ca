import { build } from 'esbuild';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewMap } from './preview-map.mjs';

/** Corpus payload builders for the /api/v1/service/* preview routes. Pure
 * functions of the scenario, computed with the real shared math. */
function previewStates(scenario, config, serviceStatesAt) {
  const states = serviceStatesAt(scenario.touches, scenario.coverage, {
    windowStart: scenario.windowStart,
    at: scenario.at,
    config,
  });
  const routesByStop = new Map();
  for (const touch of scenario.touches) {
    const bucket = routesByStop.get(touch.stopId) ?? new Set();
    bucket.add(touch.routeId);
    routesByStop.set(touch.stopId, bucket);
  }
  return {
    schemaVersion: 1,
    at: scenario.at,
    states: [...states.values()].map((state) => ({
      ...state,
      routeIds: [...(routesByStop.get(state.stopId) ?? new Set())].sort(),
    })),
  };
}

function previewWave(scenario, corridorStops) {
  const west = corridorStops.length > 0 ? [`${corridorStops[0]}_w`] : [];
  const patterns = [
    { routeId: '506', directionId: 0, stopIds: [...corridorStops, ...west] },
    { routeId: '506', directionId: 1, stopIds: [...west, ...corridorStops] },
  ];
  return {
    schemaVersion: 1,
    windowStart: scenario.windowStart,
    windowEnd: scenario.at,
    coverage: scenario.coverage,
    routes: patterns.map((pattern) => ({
      routeId: pattern.routeId,
      directionId: pattern.directionId,
      patternStopIds: pattern.stopIds,
      touches: scenario.touches
        .filter((touch) => pattern.stopIds.includes(touch.stopId))
        .map((touch) => ({
          stopIndex: pattern.stopIds.indexOf(touch.stopId),
          dt: touch.t - scenario.windowStart,
          vehicleId: touch.vehicleId,
          directionId: touch.directionId,
          mode: touch.mode,
        }))
        .sort((a, b) => a.dt - b.dt),
    })),
  };
}

/** Repeat the scenario's 30-minute window across 36 hours, fold it with the
 * real deriveRollupRows math at the 5-minute grain, and merge — the
 * sparkline's per-bucket series plus the merged summary. */
function previewHistory(scenario, config, windowSeconds, bucketSeconds, math) {
  const now = Date.now();
  const from = now - config.historyHours * 3_600_000;
  const windowMs = windowSeconds * 1000;
  // Synthesize the long stream: one scenario window per 30-minute span.
  const longTouches = [];
  for (let start = from; start < now; start += windowMs) {
    const shift = start - scenario.windowStart;
    for (const touch of scenario.touches) {
      longTouches.push({ ...touch, t: touch.t + shift });
    }
  }
  const stopIds = Object.keys(scenario.expectations);
  const summaries = [];
  const bucketSeries = [];
  for (const stopId of stopIds) {
    const stopTouches = longTouches.filter((touch) => touch.stopId === stopId);
    const rows = [];
    let previousTouchAt = null;
    for (
      let bucketStart = Math.floor(from / (bucketSeconds * 1000)) * bucketSeconds * 1000;
      bucketStart < now;
      bucketStart += bucketSeconds * 1000
    ) {
      const row = math.deriveRollupRow(
        stopId,
        bucketStart,
        bucketSeconds,
        stopTouches,
        [],
        previousTouchAt,
      );
      if (row.n > 0 || row.firstTouchAt !== null) rows.push(row);
      if (row.lastTouchAt !== null) previousTouchAt = row.lastTouchAt;
    }
    const merged = math.mergeRollupRows(rows);
    summaries.push({
      stopId,
      n: merged.n,
      meanHeadwaySeconds: math.mergedMeanSeconds(merged),
      irregularity: math.mergedCvSquared(merged),
      maxGapSeconds: math.worstGapSeconds(merged),
      backToBack: merged.backToBack,
      distinctVehicles: merged.distinctVehicles,
      routeIds: [...new Set(stopTouches.map((touch) => touch.routeId))].sort(),
      coverageRatio: 1,
      medianApproxSeconds: math.gammaApproxQuantileSeconds(merged, 0.5),
      p90ApproxSeconds: math.gammaApproxQuantileSeconds(merged, 0.9),
    });
    bucketSeries.push({
      stopId,
      buckets: rows.map((row) => ({
        bucketStart: row.bucketStart,
        n: row.n,
        maxGapSeconds: row.maxGapSeconds,
        backToBack: row.backToBack,
      })),
    });
  }
  return { schemaVersion: 1, from, to: now, summaries, bucketSeries };
}

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
    export { buildSnakeMap } from './shared/map/game-map';
    export { scenarioById, VOID_CORRIDOR_STOPS } from './shared/service/fixtures';
    export { serviceStatesAt, deriveRollupRow, mergeRollupRows, mergedMeanSeconds, mergedCvSquared, worstGapSeconds, gammaApproxQuantileSeconds } from './shared/service/wait-metrics';
    export { serviceConfig, SERVICE_WINDOW_SECONDS, SERVICE_BUCKET_SECONDS } from './shared/service/config';`,
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
    scenarioById,
    VOID_CORRIDOR_STOPS,
    serviceStatesAt,
    deriveRollupRow,
    mergeRollupRows,
    mergedMeanSeconds,
    mergedCvSquared,
    worstGapSeconds,
    gammaApproxQuantileSeconds,
    serviceConfig,
    SERVICE_WINDOW_SECONDS,
    SERVICE_BUCKET_SECONDS,
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

    // Delivered-service preview (docs/sla-stories.md E0S7): the corpus served
    // through the real math, so overlay development starts on day one with
    // zero workers, zero DO, zero live feed. Scenario selectable via
    // ?scenario= (default: the one-way void). Dev-only, never shipped.
    if (path.startsWith('/api/v1/service/')) {
      const query = new URL(request.url, 'http://localhost').searchParams;
      const scenario = scenarioById(query.get('scenario') || 'one-way-void');
      const servicePreviewConfig = serviceConfig();
      try {
        if (path === '/api/v1/service/stops') {
          const payload = previewStates(scenario, servicePreviewConfig, serviceStatesAt);
          const etag = `"preview-stops-${scenario.id}-${payload.at}"`;
          if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
            response.writeHead(304, { etag, 'cache-control': 'no-store' });
            return response.end();
          }
          return json(payload, 200, { etag, 'cache-control': 'no-store' });
        }
        if (path === '/api/v1/service/wave') {
          const payload = previewWave(scenario, VOID_CORRIDOR_STOPS);
          const etag = `"preview-wave-${scenario.id}-${payload.windowEnd}"`;
          if (ifNoneMatchMatches(request.headers['if-none-match'], etag)) {
            response.writeHead(304, { etag, 'cache-control': 'no-store' });
            return response.end();
          }
          return json(payload, 200, { etag, 'cache-control': 'no-store' });
        }
        if (path === '/api/v1/service/history') {
          // The 36-hour history, synthesized by repeating the scenario's
          // window across the span and folding it with the REAL fold math —
          // the same deriveRollupRows/merge path production uses.
          const payload = previewHistory(
            scenario,
            servicePreviewConfig,
            SERVICE_WINDOW_SECONDS,
            SERVICE_BUCKET_SECONDS,
            {
              deriveRollupRow,
              mergeRollupRows,
              mergedMeanSeconds,
              mergedCvSquared,
              worstGapSeconds,
              gammaApproxQuantileSeconds,
            },
          );
          return json(payload, 200, { 'cache-control': 'no-store' });
        }
        if (path === '/api/v1/service/preview-positions') {
          return json({ schemaVersion: 1, positions: scenario.stopPositions }, 200, {
            'cache-control': 'no-store',
          });
        }
        return json({ error: 'not-found' }, 404);
      } catch (error) {
        console.error('Service preview failed', error);
        return json({ error: 'service-preview-unavailable' }, 503);
      }
    }

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
