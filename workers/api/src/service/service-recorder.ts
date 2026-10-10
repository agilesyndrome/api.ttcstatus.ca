/** The recorder singleton Durable Object (sla.md §4.4; stories E1S1, E1S2,
 * E1S5, E1S6, E6S1). The shell is deliberately thin — alarm scheduling, the
 * feed fetch, persistence, and telemetry — so its untested surface is
 * plumbing only (story 1.7); every decision lives in the pure core
 * (recorder-core.ts) and the shared math, both exercised by the SQLite test
 * harness without a DO runtime.
 *
 * Loop per 30 s tick (§4.4): fetch both feeds in parallel via the reuse-built
 * `fetchRailSnapshot()` → pure core (detection, dwell dedupe, coverage
 * honesty) → persist touches/coverage/state to DO SQL → prune the 30-minute
 * window → assemble live states (shared math) → counters to the Analytics
 * Engine → telemetry. Upstream failures are recorded, never fabricated. */

import type { Env } from '../env';
import type { DurableObjectStateLike } from '../../../shared/cloudflare/bindings';
import { serviceConfig, SERVICE_WINDOW_SECONDS } from '../../../../shared/service/config';
import type { ServiceConfig } from '../../../../shared/service/config';
import { fetchRailSnapshot } from '../realtime/realtime';
import {
  gammaApproxQuantileSeconds,
  serviceStatesAt,
} from '../../../../shared/service/wait-metrics';
import type { MergedRollups, Moments } from '../../../../shared/service/wait-metrics';
import { WindowStore } from './window-store';
import {
  deserializeRecorderState,
  processTick,
  serializeRecorderState,
} from './recorder-core';
import { loadNetwork } from './network';
import type { RecorderNetwork } from './network';
import { runFoldCycle } from './fold';

/** The singleton's well-known name: one recorder for the whole deployment. */
export const SERVICE_RECORDER_NAME = 'service-recorder';

/** Re-check the network version hourly: the nightly GTFS flip reloads the
 * network without losing the window (story 1.2). */
const NETWORK_RECHECK_MS = 3_600_000;

export interface RecorderTelemetry {
  schemaVersion: 2;
  ticks: number;
  /** Duplicate/late alarms inside an already-processed tick (harmless). */
  duplicateTicks: number;
  lastTickId: number | null;
  lastTickAt: number | null;
  lastTickDurationMs: number | null;
  /** Where in the tick grid the last alarm fired — drift evidence (E0S5). */
  lastFireOffsetMs: number | null;
  /** The last ~40 alarm fire times, for cadence/drift measurement. */
  recentFireTimes: number[];
  surfaceStatus: 'available' | 'unavailable' | 'never-run';
  subwayStatus: 'available' | 'unavailable' | 'never-run';
  /** Ticks where both feeds were down at once. */
  upstreamFailures: number;
  /** Touches currently inside the rolling window. */
  windowTouchCount: number;
  /** The active GTFS network version the recorder matches against. */
  networkVersionId: number | null;
  /** Last network bootstrap outcome. */
  networkStatus: 'loaded' | 'pending' | 'failed';
  /** Rows pruned by the last tick (bounded-work evidence, E1S5). */
  lastPrunedRows: number | null;
  /** Stops in void state at the last tick (E6S1's void evidence). */
  voidStops: number | null;
  /** Fold telemetry (stories 4.1/4.5): loud when failing, silent never. */
  bucketsFolded: number;
  rowsFolded: number;
  rowsPrunedByRetention: number | null;
  foldFailures: number;
  lastFoldError: string | null;
}

const TELEMETRY_KEY = 'telemetry';
const FIRE_TIMES_LIMIT = 40;

const initialTelemetry: RecorderTelemetry = {
  schemaVersion: 2,
  ticks: 0,
  duplicateTicks: 0,
  lastTickId: null,
  lastTickAt: null,
  lastTickDurationMs: null,
  lastFireOffsetMs: null,
  recentFireTimes: [],
  surfaceStatus: 'never-run',
  subwayStatus: 'never-run',
  upstreamFailures: 0,
  windowTouchCount: 0,
  networkVersionId: null,
  networkStatus: 'pending',
  lastPrunedRows: null,
  voidStops: null,
  bucketsFolded: 0,
  rowsFolded: 0,
  rowsPrunedByRetention: null,
  foldFailures: 0,
  lastFoldError: null,
};

export class ServiceRecorder {
  private readonly store: WindowStore;
  private network: RecorderNetwork | null = null;
  private networkCheckedAt = 0;
  private config: ServiceConfig;
  /** Rollup-stabilized baselines for thin-window stops (E2S9), refreshed per
   * fold cycle from one grouped D1 aggregate. */
  private baselineCache = new Map<
    string,
    { medianSeconds: number; moments: Moments } | null
  >();
  private baselineCacheReady = false;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Env,
  ) {
    this.store = new WindowStore(state.storage.sql);
    this.config = serviceConfig(env);
  }

  /** Internal routes: telemetry (default), live states, and the raw window —
   * the data seams Epic 3 reads. The worker gates who may call them. Waking
   * the DO also arms the alarm loop — the entire point is measuring delivery
   * nobody is watching (recorder mode `always`, sla.md §9). */
  async fetch(request: Request): Promise<Response> {
    this.store.initialize();
    await this.ensureAlarm();
    const path = new URL(request.url).pathname;
    // Quantized to the tick grid: the payload is stable within a tick, so
    // ETags and 304s work per tick (story 3.1).
    const sampleMs = this.config.sampleSeconds * 1000;
    const at = Math.floor(Date.now() / sampleMs) * sampleMs;
    if (path === '/states') {
      const { states, touches } = await this.currentStates(at);
      const routesByStop = new Map<string, Set<string>>();
      for (const touch of touches) {
        const bucket = routesByStop.get(touch.stopId) ?? new Set<string>();
        bucket.add(touch.routeId);
        routesByStop.set(touch.stopId, bucket);
      }
      const payloadStates = [...states.values()].map((state) => {
        const routes = new Set(routesByStop.get(state.stopId));
        for (const route of this.network?.stops.get(state.stopId)?.routes ?? []) {
          routes.add(route);
        }
        return { ...state, routeIds: [...routes].sort() };
      });
      return Response.json(
        { schemaVersion: 1, at, states: payloadStates },
        {
          headers: { 'cache-control': 'no-store' },
        },
      );
    }
    if (path === '/window') {
      const { touches, coverage } = await this.currentWindow(at);
      const touchRoutes = new Set(touches.map((touch) => touch.routeId));
      const patterns = this.network
        ? [...this.network.patterns.values()]
            .filter((pattern) => touchRoutes.has(pattern.routeId))
            .map((pattern) => ({
              routeId: pattern.routeId,
              directionId: pattern.directionId,
              stopIds: pattern.stopIds,
            }))
        : [];
      return Response.json(
        {
          schemaVersion: 1,
          at,
          windowStart: at - SERVICE_WINDOW_SECONDS * 1000,
          touches,
          coverage,
          patterns,
        },
        {
          headers: { 'cache-control': 'no-store' },
        },
      );
    }
    const telemetry = await this.readTelemetry();
    return Response.json(telemetry, { headers: { 'cache-control': 'no-store' } });
  }

  async alarm(): Promise<void> {
    this.store.initialize();
    const now = Date.now();
    const tickMs = this.config.sampleSeconds * 1000;
    const tickId = Math.floor(now / tickMs);
    const telemetry = await this.readTelemetry();
    if (telemetry.lastTickId === tickId) {
      // Idempotency by construction: a duplicate or late alarm inside the
      // same tick is a provable no-op (E0S5's validated scheme).
      await this.writeTelemetry({
        ...telemetry,
        duplicateTicks: telemetry.duplicateTicks + 1,
      });
      await this.state.storage.setAlarm((Math.floor(now / tickMs) + 1) * tickMs);
      return;
    }
    const startedAt = Date.now();
    const outcome = await this.runTick(telemetry, now);
    const finishedAt = Date.now();
    await this.writeTelemetry({
      ...telemetry,
      ...outcome.telemetry,
      ticks: telemetry.ticks + 1,
      lastTickId: tickId,
      lastTickAt: now,
      lastTickDurationMs: finishedAt - startedAt,
      lastFireOffsetMs: now % tickMs,
      recentFireTimes: [...telemetry.recentFireTimes, now].slice(-FIRE_TIMES_LIMIT),
    });
    await this.state.storage.setAlarm((Math.floor(now / tickMs) + 1) * tickMs);
  }

  /** One acquisition cycle. All decisions live in the pure core and the
   * shared math; this shell only moves bytes (story 1.7). */
  private async runTick(
    telemetry: RecorderTelemetry,
    now: number,
  ): Promise<{ telemetry: Partial<RecorderTelemetry> }> {
    // Network bootstrap (story 1.2): on boot, then hourly version checks.
    let networkStatus = telemetry.networkStatus;
    if (!this.network || now - this.networkCheckedAt > NETWORK_RECHECK_MS) {
      try {
        const fresh = await loadNetwork(this.env.DB);
        const changed =
          this.network !== null && this.network.versionId !== fresh.versionId;
        this.network = fresh;
        this.networkCheckedAt = now;
        networkStatus = 'loaded';
        if (changed)
          console.log('recorder network version flipped', {
            from: telemetry.networkVersionId,
            to: fresh.versionId,
          });
      } catch (error) {
        networkStatus = 'failed';
        if (!this.network) console.error('recorder network bootstrap failed', error);
      }
    }

    let snapshot = null;
    let surfaceStatus: RecorderTelemetry['surfaceStatus'] = 'unavailable';
    let subwayStatus: RecorderTelemetry['subwayStatus'] = 'unavailable';
    let upstreamFailures = telemetry.upstreamFailures;
    const source = this.env.REALTIME_VEHICLE_URL;
    if (source) {
      try {
        snapshot = await fetchRailSnapshot(
          source,
          this.env.SOURCE_ATTRIBUTION ?? '',
          this.env.REALTIME_SUBWAY_URL,
        );
        surfaceStatus = snapshot.surfaceStatus ?? 'unavailable';
        subwayStatus = snapshot.subwayStatus ?? 'unavailable';
      } catch {
        // Both feeds down: an outage. Recorded, never fabricated.
        upstreamFailures += 1;
      }
    } else {
      upstreamFailures += 1;
    }

    const state = deserializeRecorderState(this.store.loadState());
    const output = processTick({
      now,
      config: this.config,
      network: this.network,
      snapshot,
      state,
    });
    this.store.insertTouches(output.touches);
    this.store.insertCoverage(output.coverageClosed);
    this.store.saveState(serializeRecorderState(output.state));

    // Prune the rolling window (story 1.5): nothing older than 30 minutes
    // survives at 30 s resolution, by design.
    const pruned = this.store.prune(now - SERVICE_WINDOW_SECONDS * 1000);

    // Live states from the shared math (the seam Epic 3 serves), and the
    // void-evidence counter for analytics (story 6.1). Thin-window stops get
    // rollup-stabilized baselines (story 2.6's Stage-3 upgrade, E2S9).
    const { states } = await this.currentStates(now);
    let voidStops = 0;
    for (const stopState of states.values()) {
      if (stopState.state === 'void') voidStops += 1;
    }
    const windowTouchCount = this.store.touchCount();

    // Fold + retention (stories 4.1/4.2/4.5): fold every completed bucket
    // while its raw rows survive, then the hourly 36-hour prune. A fold
    // failure is loud — telemetry + console — and retried next tick.
    let bucketsFolded = 0;
    let rowsFolded = 0;
    let rowsPrunedByRetention: number | null = null;
    let foldFailures = telemetry.foldFailures;
    let lastFoldError = telemetry.lastFoldError;
    try {
      const fold = await runFoldCycle(
        this.store,
        this.env.DB,
        this.config,
        now,
        (await this.currentWindow(now)).coverage,
      );
      bucketsFolded = fold.bucketsFolded;
      rowsFolded = fold.rowsWritten;
      rowsPrunedByRetention = fold.rowsPruned;
    } catch (error) {
      foldFailures += 1;
      lastFoldError =
        error instanceof Error
          ? `${error.message}${error.cause ? `: ${String(error.cause)}` : ''}`
          : String(error);
      console.error('recorder fold failed — loud, not silent', {
        error: lastFoldError,
        at: now,
      });
    }
    if (bucketsFolded > 0) {
      this.baselineCacheReady = false;
    }
    if (!this.baselineCacheReady) {
      await this.refreshBaselineCache(now);
    }

    // Analytics Engine counters (story 6.1): long-term trends with zero
    // event retention. Fire-and-forget; optional binding, no-op unset.
    const tickId = Math.floor(now / (this.config.sampleSeconds * 1000));
    this.env.ANALYTICS?.writeDataPoint({
      blobs: ['service-tick'],
      doubles: [
        output.counters.streetcarTouches,
        output.counters.subwayTouches,
        this.config.sampleSeconds / 60, // coverage minutes represented by this tick
        voidStops * (this.config.sampleSeconds / 60),
        output.counters.outageTicks,
        output.counters.noReportTicks,
      ],
      indexes: [tickId],
    });

    return {
      telemetry: {
        surfaceStatus,
        subwayStatus,
        upstreamFailures,
        windowTouchCount,
        networkVersionId: this.network?.versionId ?? null,
        networkStatus,
        lastPrunedRows: pruned,
        voidStops,
        bucketsFolded,
        rowsFolded,
        rowsPrunedByRetention,
        foldFailures,
        lastFoldError,
      },
    };
  }

  /** The rolling window's touches + coverage, with still-open coverage runs
   * synthesized up to `now` (the current outage is unmonitored time too). */
  private async currentWindow(now = Date.now()) {
    const from = now - SERVICE_WINDOW_SECONDS * 1000;
    const touches = this.store.loadTouches(from);
    const closed = this.store.loadCoverage();
    const state = deserializeRecorderState(this.store.loadState());
    const open = Object.entries(state.coverageRuns)
      .filter(([, run]) => run && run.kind !== 'observable')
      .map(([mode, run]) => ({
        from: run!.from,
        to: now,
        mode: mode as 'streetcar' | 'subway',
        kind: run!.kind,
      }));
    return { touches, coverage: [...closed, ...open] };
  }

  private async currentStates(now = Date.now()) {
    const { touches, coverage } = await this.currentWindow(now);
    const states = serviceStatesAt(touches, coverage, {
      windowStart: now - SERVICE_WINDOW_SECONDS * 1000,
      at: now,
      config: this.config,
      // Story 2.6's Stage-3 upgrade (E2S9): a stop whose window is too thin
      // for a baseline borrows the merged rollup moments of its last 36
      // hours — its delivered baseline stops forgetting itself every 30
      // minutes. Median is the gamma approximation there, labelled as such.
      stabilized: (stopId) => this.baselineCache.get(stopId) ?? null,
    });
    return { states, touches, coverage };
  }

  /** One grouped aggregate over the 36-hour rollups builds every stop's
   * stabilized baseline at once — refreshed per fold cycle, so per-tick D1
   * work stays bounded. */
  private async refreshBaselineCache(now: number): Promise<void> {
    try {
      const rows = (
        await this.env.DB.prepare(
          `SELECT stop_id, SUM(n) AS n, SUM(headway_sum) AS sum, SUM(headway_sum_sq) AS sum_sq
             FROM service_rollups WHERE bucket_start >= ?
             GROUP BY stop_id`,
        )
          .bind(now - this.config.historyHours * 3_600_000)
          .all()
      ).results as Array<{ stop_id: string; n: number; sum: number; sum_sq: number }>;
      const cache = new Map<string, { medianSeconds: number; moments: Moments } | null>();
      for (const row of rows) {
        if (!(row.n > 0) || !(row.sum > 0)) continue;
        const merged: MergedRollups = {
          rows: 1,
          n: row.n,
          sum: row.sum,
          sumSq: row.sum_sq,
          maxGapSeconds: null,
          maxCrossGapSeconds: null,
          backToBack: 0,
          distinctVehicles: 0,
          routeIds: [],
          firstTouchAt: null,
          lastTouchAt: null,
          coverageBits: 0,
          coverageSlots: 0,
        };
        const medianSeconds = gammaApproxQuantileSeconds(merged, 0.5);
        if (medianSeconds !== null) {
          cache.set(row.stop_id, {
            medianSeconds,
            moments: { n: row.n, sum: row.sum, sumSq: row.sum_sq },
          });
        }
      }
      this.baselineCache = cache;
    } catch (error) {
      // Keep the previous cache; stabilization is an upgrade, never a
      // dependency — thin stops simply stay collecting.
      console.error('recorder baseline refresh failed', error);
    }
    this.baselineCacheReady = true;
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.state.storage.getAlarm()) === null) {
      const tickMs = this.config.sampleSeconds * 1000;
      await this.state.storage.setAlarm((Math.floor(Date.now() / tickMs) + 1) * tickMs);
    }
  }

  private async readTelemetry(): Promise<RecorderTelemetry> {
    const stored = await this.state.storage.get(TELEMETRY_KEY);
    return stored ? (stored as RecorderTelemetry) : { ...initialTelemetry };
  }

  private async writeTelemetry(telemetry: RecorderTelemetry): Promise<void> {
    await this.state.storage.put(TELEMETRY_KEY, telemetry);
  }
}
