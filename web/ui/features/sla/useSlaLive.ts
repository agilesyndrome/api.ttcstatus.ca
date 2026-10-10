import { useEffect, useState } from 'react';
import type { SlaReportResponse } from '../../../../shared/service/contracts';
import {
  liveBucketsForRoute,
  liveBucketsForStop,
  type SlaLiveBucket,
  type SlaLiveStates,
  type SlaLiveWave,
} from './sla-live';

/** The live segment's data cadence, from the recorder's own conventions:
 * the states payload is recomputed on every 30-second tick (poll with a
 * retained ETag — 304s between ticks), and the wave backfills the full
 * 30-minute window on load and then only once per 5 minutes (the oldest
 * sliver rolls off only at bucket boundaries). All requests pause while
 * the tab is hidden and resume with an immediate refresh. */
const STATES_POLL_MS = 30_000;
const WAVE_POLL_MS = 300_000;
const BACKOFF_MAX_MS = 300_000;

export interface SlaLiveState {
  /** Per routeId, oldest → newest. */
  byRoute: Map<string, SlaLiveBucket[]>;
  /** Per stopId (stops appearing in the wave), oldest → newest. */
  byStop: Map<string, SlaLiveBucket[]>;
  /** The wave's windowEnd — the freshest moment the slivers represent. */
  windowEnd: number | null;
  /** True once both sources have loaded at least once. */
  ready: boolean;
}

interface FetchLoopOptions {
  url: string;
  intervalMs: number;
  onSuccess(payload: unknown, etag: string | null): void;
}

/** A minimal version of the house feed loop (useServiceFeed): retained
 * If-None-Match, hidden-tab pause with immediate refresh on return, and
 * exponential backoff on failure — never a tighter loop than the recorder
 * itself publishes. */
function useFetchLoop(enabled: boolean, options: FetchLoopOptions) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let etag: string | null = null;
    let failureBackoff = options.intervalMs;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      const headers: Record<string, string> = {};
      if (etag) headers['if-none-match'] = etag;
      try {
        const response = await fetch(options.url, {
          headers,
          cache: 'no-store',
          credentials: 'omit',
        });
        if (response.status === 304) {
          etag = response.headers.get('etag') ?? etag;
        } else if (response.ok) {
          etag = response.headers.get('etag');
          options.onSuccess(await response.json(), etag);
        } else {
          throw new Error(`live fetch HTTP ${response.status}`);
        }
        failureBackoff = options.intervalMs;
        schedule(options.intervalMs);
      } catch {
        if (stopped) return;
        failureBackoff = Math.min(failureBackoff * 2, BACKOFF_MAX_MS);
        schedule(failureBackoff);
      }
    };

    const schedule = (delay: number) => {
      if (stopped) return;
      timer = setTimeout(run, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !stopped) {
        if (timer) clearTimeout(timer);
        run();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    run();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line -- options are stable per call site; the
    // loop identity follows `enabled`.
  }, [enabled]);
}

export function useSlaLive(report: SlaReportResponse | null): SlaLiveState {
  const [wave, setWave] = useState<SlaLiveWave | null>(null);
  const [states, setStates] = useState<SlaLiveStates | null>(null);

  const liveRoutes = report?.routes.filter((route) => route.todayHeadways) ?? [];
  const enabled = Boolean(report && report.targets.todayClass && liveRoutes.length > 0);

  useFetchLoop(enabled, {
    url: '/api/v1/service/stops',
    intervalMs: STATES_POLL_MS,
    onSuccess: (payload) => setStates(payload as SlaLiveStates),
  });
  useFetchLoop(enabled, {
    url: '/api/v1/service/wave',
    intervalMs: WAVE_POLL_MS,
    onSuccess: (payload) => setWave(payload as SlaLiveWave),
  });

  const [live, setLive] = useState<SlaLiveState>({
    byRoute: new Map(),
    byStop: new Map(),
    windowEnd: null,
    ready: false,
  });

  useEffect(() => {
    if (!wave || !states || !report) return;
    const statesByStopId = new Map(
      states.states.map((state) => [
        state.stopId,
        { lastTouchAt: state.lastTouchAt, routeIds: state.routeIds },
      ]),
    );
    const byRoute = new Map<string, SlaLiveBucket[]>();
    const byStop = new Map<string, SlaLiveBucket[]>();
    for (const route of liveRoutes) {
      byRoute.set(
        route.routeId,
        liveBucketsForRoute(
          route.routeId,
          wave,
          statesByStopId,
          route.todayHeadways,
          report.targets.toleranceRatio,
          report.targets.metRatio,
          report.targets.degradedRatio,
        ),
      );
    }
    // Stop rows live inside a route's expansion, so their slivers use THAT
    // route's advertised target — a shared corridor's stop keeps each route's
    // truth rather than whichever pattern came first.
    for (const route of liveRoutes) {
      const patternStops = new Set<string>();
      for (const waveRoute of wave.routes) {
        if (waveRoute.routeId !== route.routeId) continue;
        for (const stopId of waveRoute.patternStopIds) patternStops.add(stopId);
      }
      for (const stopId of patternStops) {
        byStop.set(
          `${route.routeId}|${stopId}`,
          liveBucketsForStop(
            stopId,
            wave,
            statesByStopId,
            route.todayHeadways,
            report.targets.toleranceRatio,
            report.targets.metRatio,
            report.targets.degradedRatio,
          ),
        );
      }
    }
    setLive({ byRoute, byStop, windowEnd: wave.windowEnd, ready: true });
    // The report identity changes only between folds; the recomputation
    // follows the polling payloads, not the report object.
    // eslint-disable-next-line -- payloads drive the recompute
  }, [wave, states]);

  return live;
}
