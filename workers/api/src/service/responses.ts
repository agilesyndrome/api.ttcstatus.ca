/** `GET /api/v1/service/history` and `GET /api/v1/service/wave` (sla.md
 * stories 3.2/4.3; docs/optimize-overlay.md Epic 3): what remains of the
 * Worker's delivered-service surface. The stops endpoint is GONE — its
 * payload is public broadcast data served from the live bucket's per-tick
 * documents, and the recorder is write-only for states by construction.
 *
 *  - History is public broadcast data (identical per stop for every
 *    caller): the selected stop's card needs it and the overlay is for
 *    every visitor, so no session, `public, max-age=300`, and the same
 *    Workers edge-cache pattern the map endpoints use — the second
 *    identical request is a HIT that never touches D1. The narrowing
 *    filter requirement (`?stop=` or `?routes=`) stays so queries stay
 *    bounded. Default windows are quantized to the 5-minute fold grid so
 *    payloads are fold-stable: 304s work between folds and the ETag stops
 *    churning per second.
 *  - Wave is the members-only replay (the E4S5 /sla decision): a verified
 *    session at the router, `private` — never a shared cache. Its payload
 *    is tick-stable, so the serialize + hash runs once per tick per
 *    isolate (E3S4), not per request.
 *
 * An unreachable recorder is its own honest 503 — never a fabricated
 * payload. */

import type { Env } from '../env';
import type { ExecutionContextLike } from '../../../shared/cloudflare/bindings';
import { json } from '../http/responses';
import { ifNoneMatchMatches } from '../../../../shared/http/etag';
import { sha256Hex } from '../../../shared/gtfs/hash';
import { serviceConfig, SERVICE_BUCKET_SECONDS } from '../../../../shared/service/config';
import type {
  CoverageInterval,
  RollupRow,
  ServiceHistoryResponse,
  ServiceWaveResponse,
  TouchEvent,
  WaveTouch,
} from '../../../../shared/service/contracts';
import { recorderFetch } from './recorder-client';
import {
  gammaApproxQuantileSeconds,
  mergeRollupRows,
  mergedCvSquared,
  mergedMeanSeconds,
  worstGapSeconds,
} from '../../../../shared/service/wait-metrics';

/** The wave's browser cache hint (private — a members surface). */
const WAVE_CACHE_SECONDS = 15;

interface RecorderWindowPayload {
  schemaVersion: 1;
  at: number;
  windowStart: number;
  touches: TouchEvent[];
  coverage: CoverageInterval[];
  patterns: Array<{ routeId: string; directionId: 0 | 1; stopIds: string[] }>;
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

/** GET /api/v1/service/history — merged-moment summaries per stop or route
 * over any sub-window of the 36 hours (sla.md story 4.3). Reads D1 directly
 * (the rollups are the history); requires a narrowing filter (`?stop=` or
 * `?routes=`) so queries stay bounded. Public broadcast data since
 * docs/optimize-overlay.md E3S1: edge-cached by full URL (filter included),
 * fold-stable between rollup writes. */
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
  // E3S4: default windows quantize to the 5-minute fold grid — the payload
  // is fold-stable, so 304s work between folds and edge entries do not churn
  // per second. An explicit `from` keeps the caller's exact window.
  const now = Date.now();
  const bucketMs = SERVICE_BUCKET_SECONDS * 1000;
  const floorBucket = (at: number) => Math.floor(at / bucketMs) * bucketMs;
  const requestedFrom = Number(url.searchParams.get('from'));
  const from =
    Number.isFinite(requestedFrom) && requestedFrom > 0
      ? requestedFrom
      : floorBucket(now - config.historyHours * 3_600_000);
  const to = floorBucket(now);

  // The edge cache (E3S1): identical questions get identical public bytes —
  // the second caller never touches D1. Keyed by the full URL, selectors
  // included, so one filter can never bleed into another's entry.
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(
    `https://ttcstatus-cache.invalid${url.pathname}${url.search}`,
    {
      method: 'GET',
    },
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('x-ttcstatus-cache', 'HIT');
    return conditional(request, new Response(cached.body, { status: 200, headers }));
  }

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
    to,
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
    'cache-control': 'public, max-age=300',
    etag,
    'x-ttcstatus-cache': 'MISS',
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
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

/** The wave payload is tick-stable (the recorder quantizes `/window` to the
 * tick grid), so the serialize + SHA-256 runs once per tick per isolate —
 * E3S4 (docs/optimize-overlay.md): same-tick requests — including 304s,
 * which today pay the full hash — serve the memoized bytes. Keyed by tick
 * and routes filter, so one filter can never serve another's payload. */
let waveMemo: { key: string; body: string; etag: string } | null = null;

export async function serviceWaveResponse(request: Request, env: Env): Promise<Response> {
  const config = serviceConfig(env);
  const url = new URL(request.url);
  const filter = parseRoutesFilter(url.searchParams.get('routes'));
  let payload: RecorderWindowPayload;
  try {
    const response = await recorderFetch(env, '/window');
    if (!response.ok) return unavailable();
    payload = (await response.json()) as RecorderWindowPayload;
  } catch {
    return unavailable();
  }
  const memoKey = `${Math.floor(payload.at / (config.sampleSeconds * 1000))}|${url.searchParams.get('routes') ?? ''}`;
  if (waveMemo && waveMemo.key === memoKey) {
    // Same tick: the memoized public bytes, served behind the session gate.
    const hit = new Response(waveMemo.body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `private, max-age=${WAVE_CACHE_SECONDS}`,
        etag: waveMemo.etag,
        'x-live-update-seconds': String(config.sampleSeconds),
        'x-live-next-update-at': new Date(
          payload.at + config.sampleSeconds * 1000,
        ).toISOString(),
      },
    });
    return conditional(request, hit);
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
  const serialized = JSON.stringify(body);
  const etag = `"wave-${await sha256Hex(serialized)}"`;
  waveMemo = { key: memoKey, body: serialized, etag };
  const response = new Response(serialized, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Members-only surface (E4S5): private, never a shared cache.
      'cache-control': `private, max-age=${WAVE_CACHE_SECONDS}`,
      etag,
      'x-live-update-seconds': String(config.sampleSeconds),
      'x-live-next-update-at': new Date(
        payload.at + config.sampleSeconds * 1000,
      ).toISOString(),
    },
  });
  return conditional(request, response);
}
