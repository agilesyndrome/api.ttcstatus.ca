/** The live segment's brain (the /sla page's third tier): thin slivers at
 * the right edge of each strip, one per completed 5-minute bucket of the
 * recorder's rolling 30-minute window — instant realtime, visually
 * distinct from the thicker daily and weekly boxes.
 *
 * Honesty rules, unchanged (sla.md §3.6): every number here is either the
 * recorder's already-computed live state (per-stop `lastTouchAt` from
 * /api/v1/service/stops, refreshed on its own 30-second tick) or a raw
 * windowed touch (from /api/v1/service/wave) — the server computes NOTHING
 * at request time; this module runs in the browser, exactly like the map
 * overlay's field (wave-field.ts) does. A stop the feeds couldn't see is
 * excluded, never counted against the route; an hour with no scheduled
 * service carries no promise; a bucket inside a feed outage renders grey. */

import type { SlaBandKind } from '../../../../shared/service/sla-metrics';
import {
  slaBandFor,
  slaThresholdSeconds,
  torontoWallHour,
} from '../../../../shared/service/sla-metrics';

/** The subset of the wave payload the brain consumes. */
export interface SlaLiveWave {
  windowStart: number;
  windowEnd: number;
  routes: Array<{
    routeId: string;
    patternStopIds: string[];
    touches: Array<{ stopIndex: number; dt: number }>;
  }>;
  coverage: Array<{ from: number; to: number; kind: string }>;
}

/** The subset of the live states payload the brain consumes. */
export interface SlaLiveStates {
  at: number;
  states: Array<{
    stopId: string;
    lastTouchAt: number | null;
    routeIds: string[];
  }>;
}

/** One thin sliver: the delivered-vs-promised picture for a single
 * 5-minute bucket. */
export interface SlaLiveBucket {
  /** Epoch ms at the bucket's end (a 5-minute grid boundary). */
  endAt: number;
  /** Share of the route's promised stops within θ at the bucket's end,
   * 0..1 — or null when no promised stop had observable data. */
  compliance: number | null;
  band: SlaBandKind;
  /** False when the feeds couldn't see the bucket at all — grey, never
   * counted against anyone. */
  monitored: boolean;
}

const BUCKET_MS = 300_000;
const LIVE_BUCKETS = 6;

/** Bucket ends: the 6 completed 5-minute grid boundaries ending at or
 * before the wave's windowEnd — exactly the recorder's own bucket grid. */
export function liveBucketEnds(windowEnd: number): number[] {
  const last = Math.floor(windowEnd / BUCKET_MS) * BUCKET_MS;
  return Array.from({ length: LIVE_BUCKETS }, (_, index) => last - index * BUCKET_MS);
}

function lastTouchAtOrBefore(
  times: number[],
  before: number,
  stateTouch: number | null,
): number | null {
  let latest: number | null = null;
  for (const time of times) {
    if (time <= before && (latest === null || time > latest)) latest = time;
  }
  if (
    stateTouch !== null &&
    stateTouch <= before &&
    (latest === null || stateTouch > latest)
  ) {
    latest = stateTouch;
  }
  return latest;
}

function bucketUnmonitored(
  endAt: number,
  coverage: Array<{ from: number; to: number; kind: string }>,
): boolean {
  const from = endAt - BUCKET_MS;
  for (const interval of coverage) {
    if (interval.kind === 'observable') continue;
    if (interval.from <= from && interval.to >= endAt) return true;
  }
  return false;
}

/** Per-route live buckets: for each completed bucket, the share of the
 * route's stops whose elapsed-since-last-touch was within the route's
 * advertised target for that wall-clock hour (× tolerance — the same θ the
 * daily fold uses). Dry stops (no touch inside the window) are judged from
 * the live states' `lastTouchAt`, so a corridor silent for the whole window
 * is honestly red, never excluded. */
export function liveBucketsForRoute(
  routeId: string,
  wave: SlaLiveWave,
  statesByStopId: Map<string, { lastTouchAt: number | null; routeIds: string[] }>,
  todayHeadways: Array<number | null> | null,
  toleranceRatio: number,
  metRatio: number,
  degradedRatio: number,
): SlaLiveBucket[] {
  const patternRoutes = wave.routes.filter((route) => route.routeId === routeId);
  const stops = new Set<string>();
  const touchesByStop = new Map<string, number[]>();
  for (const route of patternRoutes) {
    for (const stopId of route.patternStopIds) stops.add(stopId);
    for (const touch of route.touches) {
      const stopId = route.patternStopIds[touch.stopIndex];
      if (!stopId) continue;
      stops.add(stopId);
      const list = touchesByStop.get(stopId) ?? [];
      list.push(wave.windowStart + touch.dt);
      touchesByStop.set(stopId, list);
    }
  }
  // Stops known only from the live states (a route with no wave patterns
  // still gets judged on the stops its vehicles last touched).
  for (const [stopId, state] of statesByStopId) {
    if (state.routeIds.includes(routeId)) stops.add(stopId);
  }

  return liveBucketsForStops(
    [...stops],
    touchesByStop,
    statesByStopId,
    wave,
    todayHeadways,
    toleranceRatio,
    metRatio,
    degradedRatio,
  );
}

/** Per-stop live buckets (the expanded stop rows) — the same judgement for
 * a single stop, against its route's advertised target. */
export function liveBucketsForStop(
  stopId: string,
  wave: SlaLiveWave,
  statesByStopId: Map<string, { lastTouchAt: number | null; routeIds: string[] }>,
  todayHeadways: Array<number | null> | null,
  toleranceRatio: number,
  metRatio: number,
  degradedRatio: number,
): SlaLiveBucket[] {
  const touchesByStop = new Map<string, number[]>();
  for (const route of wave.routes) {
    if (!route.patternStopIds.includes(stopId)) continue;
    for (const touch of route.touches) {
      if (route.patternStopIds[touch.stopIndex] !== stopId) continue;
      const list = touchesByStop.get(stopId) ?? [];
      list.push(wave.windowStart + touch.dt);
      touchesByStop.set(stopId, list);
    }
  }
  return liveBucketsForStops(
    [stopId],
    touchesByStop,
    statesByStopId,
    wave,
    todayHeadways,
    toleranceRatio,
    metRatio,
    degradedRatio,
  );
}

function liveBucketsForStops(
  stopIds: string[],
  touchesByStop: Map<string, number[]>,
  statesByStopId: Map<string, { lastTouchAt: number | null; routeIds: string[] }>,
  wave: SlaLiveWave,
  todayHeadways: Array<number | null> | null,
  toleranceRatio: number,
  metRatio: number,
  degradedRatio: number,
): SlaLiveBucket[] {
  return liveBucketEnds(wave.windowEnd).map((endAt) => {
    const unmonitored = bucketUnmonitored(endAt, wave.coverage);
    const wallHour = torontoWallHour(endAt);
    const target = todayHeadways?.[wallHour] ?? null;
    if (unmonitored) {
      return {
        endAt,
        compliance: null,
        band: 'no-data' as SlaBandKind,
        monitored: false,
      };
    }
    if (target === null || target <= 0) {
      // No scheduled service in this hour: no promise, no verdict.
      return { endAt, compliance: null, band: 'no-data' as SlaBandKind, monitored: true };
    }
    const threshold = slaThresholdSeconds(target, toleranceRatio) * 1000;
    let met = 0;
    let judged = 0;
    for (const stopId of stopIds) {
      const touches = touchesByStop.get(stopId) ?? [];
      const last = lastTouchAtOrBefore(
        touches,
        endAt,
        statesByStopId.get(stopId)?.lastTouchAt ?? null,
      );
      if (last === null) continue; // never seen in this window: excluded, never red
      judged += 1;
      if (endAt - last <= threshold) met += 1;
    }
    const compliance = judged > 0 ? met / judged : null;
    return {
      endAt,
      compliance: compliance === null ? null : Number(compliance.toFixed(4)),
      band: slaBandFor(compliance, metRatio, degradedRatio),
      monitored: true,
    };
  });
}
