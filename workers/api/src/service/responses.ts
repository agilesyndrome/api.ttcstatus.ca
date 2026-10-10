/** `GET /api/v1/service/stops` and `GET /api/v1/service/wave` (sla.md stories
 * 3.1–3.3): live delivered-service state with the vehicles-endpoint
 * conventions — ETag/304 per tick, `X-Live-*` cadence headers, ~15 s edge
 * cache, CORS. Data comes from the recorder singleton over its internal
 * stub fetch; the recorder quantizes payloads to the tick so a 30 s tick
 * changes the ETag and 304s work in between. An unreachable recorder is its
 * own honest 503 — never a fabricated payload. */

import type { Env } from '../env';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { json } from '../http/responses';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';
import { sha256Hex } from '../../../shared/gtfs/hash';
import { serviceConfig } from '../../../../shared/service/config';
import type {
  CoverageInterval,
  RollupRow,
  ServiceHistoryResponse,
  ServiceWaveResponse,
  StopServiceState,
  TouchEvent,
  WaveTouch,
} from '../../../../shared/service/contracts';
import { SERVICE_RECORDER_NAME } from './service-recorder';
import {
  gammaApproxQuantileSeconds,
  mergeRollupRows,
  mergedCvSquared,
  mergedMeanSeconds,
  worstGapSeconds,
} from '../../../../shared/service/wait-metrics';

/** ~15 s edge cache per the story card; the browser still refreshes per the
 * X-Live cadence, and the shared cache absorbs viewer fan-out. */
const STOPS_CACHE_SECONDS = 15;

type StopStateWithRoutes = StopServiceState & { routeIds: string[] };

interface RecorderStatesPayload {
  schemaVersion: 1;
  at: number;
  states: StopStateWithRoutes[];
}

interface RecorderWindowPayload {
  schemaVersion: 1;
  at: number;
  windowStart: number;
  touches: TouchEvent[];
  coverage: CoverageInterval[];
  patterns: Array<{ routeId: string; directionId: 0 | 1; stopIds: string[] }>;
}

async function recorderFetch(env: Env, path: string): Promise<Response> {
  // The DO name lives in the hostname so the route is a clean pathname
  // ('/states', '/window') inside the Durable Object.
  const id = env.SERVICE_RECORDER.idFromName(SERVICE_RECORDER_NAME);
  return env.SERVICE_RECORDER.get(id).fetch(`https://service-recorder.internal${path}`);
}

function parseRoutesFilter(value: string | null): Set<string> | null {
  if (!value) return null;
  const routes = value
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);
  return routes.length > 0 ? new Set(routes) : null;
}

const conditional = (request: Request, response: Response): Response =>
  ifNoneMatchMatches(request.headers.get('if-none-match'), response.headers.get('etag'))
    ? new Response(null, { status: 304, headers: response.headers })
    : response;

const unavailable = () =>
  json({ error: 'service-unavailable' }, 503, {
    'cache-control': 'no-store',
    'retry-after': '5',
  });

/** Round the continuous fields for the wire: three decimals is far finer
 * than the 30 s sampling resolution, and it keeps worst-case payloads
 * (~3 k active stops) comfortably inside the fleet endpoint's size
 * discipline. */
function wireReadyStopState(state: StopStateWithRoutes): StopStateWithRoutes {
  const round = (value: number | null, decimals: number): number | null =>
    value === null ? null : Number(value.toFixed(decimals));
  return {
    ...state,
    minutesSince: round(state.minutesSince, 3),
    medianHeadwayOwnSeconds: round(state.medianHeadwayOwnSeconds, 3),
    irregularity: round(state.irregularity, 4),
    expectedWaitSeconds: round(state.expectedWaitSeconds, 3),
    dryness: round(state.dryness, 4),
  };
}

/** GET /api/v1/service/stops — per directional stop: lastTouchAt,
 * minutesSince, medianHeadwayOwn, irregularity (CV²), expectedWait R(e),
 * dryness r, state, coverage badge; `?routes=` filter (sla.md story 3.1). */
export async function serviceStopsResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const config = serviceConfig(env);
  const url = new URL(request.url);
  const filter = parseRoutesFilter(url.searchParams.get('routes'));
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(
    `https://ttcstatus-cache.invalid/api/v1/service/stops?routes=${encodeURIComponent(
      url.searchParams.get('routes') ?? '',
    )}`,
  );
  const cached = await cache.match(key);
  if (cached) return conditional(request, cached);
  let payload: RecorderStatesPayload;
  try {
    const response = await recorderFetch(env, '/states');
    if (!response.ok) return unavailable();
    payload = (await response.json()) as RecorderStatesPayload;
  } catch {
    return unavailable();
  }
  const states = (
    filter
      ? payload.states.filter((state) =>
          state.routeIds.some((route) => filter.has(route)),
        )
      : payload.states
  ).map(wireReadyStopState);
  const body = { schemaVersion: 1 as const, at: payload.at, states };
  const etag = `"stops-${await sha256Hex(JSON.stringify(body))}"`;
  const response = json(body, 200, {
    'cache-control': `public, max-age=${STOPS_CACHE_SECONDS}`,
    etag,
    'x-live-update-seconds': String(config.sampleSeconds),
    'x-live-next-update-at': new Date(
      payload.at + config.sampleSeconds * 1000,
    ).toISOString(),
  });
  ctx.waitUntil(cache.put(key, response.clone()));
  return conditional(request, response);
}

/** GET /api/v1/service/history — merged-moment summaries per stop or route
 * over any sub-window of the 36 hours (sla.md story 4.3). Reads D1 directly
 * (the rollups are the history); requires a narrowing filter (`?stop=` or
 * `?routes=`) so queries stay bounded; cached 1–5 minutes. */
export async function serviceHistoryResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const config = serviceConfig(env);
  const url = new URL(request.url);
  const stop = url.searchParams.get('stop');
  const routes = parseRoutesFilter(url.searchParams.get('routes'));
  if (!stop && !routes) {
    return json({ error: 'history-query-required' }, 400, {
      'cache-control': 'no-store',
    });
  }
  const now = Date.now();
  const from =
    Number(url.searchParams.get('from')) || now - config.historyHours * 3_600_000;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(
    `https://ttcstatus-cache.invalid/api/v1/service/history${url.search}`,
  );
  const cached = await cache.match(key);
  if (cached) return conditional(request, cached);
  let rows: RollupRow[];
  try {
    const query = stop
      ? `SELECT stop_id, bucket_start, n, headway_sum, headway_sum_sq, max_gap_seconds,
                first_touch_at, last_touch_at, back_to_back, distinct_vehicles, route_ids, coverage_bits
         FROM service_rollups WHERE bucket_start >= ? AND stop_id = ?
         ORDER BY bucket_start`
      : `SELECT stop_id, bucket_start, n, headway_sum, headway_sum_sq, max_gap_seconds,
                first_touch_at, last_touch_at, back_to_back, distinct_vehicles, route_ids, coverage_bits
         FROM service_rollups WHERE bucket_start >= ?
         ORDER BY bucket_start, stop_id`;
    const bound = stop
      ? env.DB.prepare(query).bind(from, stop)
      : env.DB.prepare(query).bind(from);
    const results = (await bound.all()).results as Array<Record<string, unknown>>;
    rows = results.map(rowToRollup);
  } catch {
    return unavailable();
  }
  if (routes) {
    rows = rows.filter((row) => row.routeIds.some((route) => routes.has(route)));
  }
  const byStop = new Map<string, RollupRow[]>();
  for (const row of rows) {
    const bucket = byStop.get(row.stopId) ?? [];
    bucket.push(row);
    byStop.set(row.stopId, bucket);
  }
  const summaries = [...byStop.entries()].map(([stopId, stopRows]) => {
    const merged = mergeRollupRows(stopRows);
    const watchedSlots = stopRows.reduce(
      (total, row) => total + popcount(row.coverageBits),
      0,
    );
    return {
      stopId,
      n: merged.n,
      meanHeadwaySeconds: mergedMeanSeconds(merged),
      irregularity: mergedCvSquared(merged),
      maxGapSeconds: worstGapSeconds(merged),
      backToBack: merged.backToBack,
      distinctVehicles: merged.distinctVehicles,
      routeIds: merged.routeIds,
      coverageRatio: merged.coverageSlots > 0 ? watchedSlots / merged.coverageSlots : 0,
      medianApproxSeconds: gammaApproxQuantileSeconds(merged, 0.5),
      p90ApproxSeconds: gammaApproxQuantileSeconds(merged, 0.9),
    };
  });
  const body: ServiceHistoryResponse = {
    schemaVersion: 1,
    from,
    to: now,
    summaries,
    ...(stop
      ? {
          bucketSeries: summaries.map((summary) => ({
            stopId: summary.stopId,
            buckets: (byStop.get(summary.stopId) ?? []).map((row) => ({
              bucketStart: row.bucketStart,
              n: row.n,
              maxGapSeconds: row.maxGapSeconds,
              backToBack: row.backToBack,
            })),
          })),
        }
      : {}),
  };
  const etag = `"history-${await sha256Hex(JSON.stringify(body))}"`;
  const response = json(body, 200, {
    // Cached 1–5 minutes per the story card: history is warm data.
    'cache-control': 'public, max-age=300',
    etag,
  });
  ctx.waitUntil(cache.put(key, response.clone()));
  return conditional(request, response);
}

function rowToRollup(row: Record<string, unknown>): RollupRow {
  return {
    stopId: String(row.stop_id),
    bucketStart: Number(row.bucket_start),
    n: Number(row.n),
    headwaySum: Number(row.headway_sum),
    headwaySumSq: Number(row.headway_sum_sq),
    maxGapSeconds: Number(row.max_gap_seconds),
    firstTouchAt: row.first_touch_at === null ? null : Number(row.first_touch_at),
    lastTouchAt: row.last_touch_at === null ? null : Number(row.last_touch_at),
    backToBack: Number(row.back_to_back),
    distinctVehicles: Number(row.distinct_vehicles),
    routeIds: JSON.parse(String(row.route_ids ?? '[]')) as string[],
    coverageBits: Number(row.coverage_bits),
  };
}

function popcount(bits: number): number {
  let count = 0;
  let value = bits;
  while (value) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}
export async function serviceWaveResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const config = serviceConfig(env);
  const url = new URL(request.url);
  const filter = parseRoutesFilter(url.searchParams.get('routes'));
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(
    `https://ttcstatus-cache.invalid/api/v1/service/wave?routes=${encodeURIComponent(
      url.searchParams.get('routes') ?? '',
    )}`,
  );
  const cached = await cache.match(key);
  if (cached) return conditional(request, cached);
  let payload: RecorderWindowPayload;
  try {
    const response = await recorderFetch(env, '/window');
    if (!response.ok) return unavailable();
    payload = (await response.json()) as RecorderWindowPayload;
  } catch {
    return unavailable();
  }
  const routes = payload.patterns
    .filter((pattern) => !filter || filter.has(pattern.routeId))
    .map((pattern) => {
      const touches: WaveTouch[] = payload.touches
        .filter((touch) => pattern.stopIds.includes(touch.stopId))
        .map((touch) => ({
          stopIndex: pattern.stopIds.indexOf(touch.stopId),
          dt: touch.t - payload.windowStart,
          vehicleId: touch.vehicleId,
          directionId: touch.directionId,
          mode: touch.mode,
        }))
        .sort((a, b) => a.dt - b.dt);
      return {
        routeId: pattern.routeId,
        directionId: pattern.directionId,
        patternStopIds: pattern.stopIds,
        touches,
      };
    });
  const body: ServiceWaveResponse = {
    schemaVersion: 1,
    windowStart: payload.windowStart,
    windowEnd: payload.at,
    routes,
    coverage: payload.coverage,
  };
  const etag = `"wave-${await sha256Hex(JSON.stringify(body))}"`;
  const response = json(body, 200, {
    'cache-control': `public, max-age=${STOPS_CACHE_SECONDS}`,
    etag,
    'x-live-update-seconds': String(config.sampleSeconds),
    'x-live-next-update-at': new Date(
      payload.at + config.sampleSeconds * 1000,
    ).toISOString(),
  });
  ctx.waitUntil(cache.put(key, response.clone()));
  return conditional(request, response);
}
