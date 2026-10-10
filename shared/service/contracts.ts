/** SLA delivered-service contracts — the single vocabulary for worker, tests, and UI.
 * Background: docs/sla.md §4.3 (data model), §5 (stories E0S1, E3S1–E3S3, E4S3).
 * Pure types and tiny constants only: no I/O, no runtime dependencies.
 *
 * Units, everywhere: timestamps are epoch milliseconds (UTC); durations are
 * seconds. Any "day" rendering happens in the UI in America/Toronto.
 */

export type ServiceMode = 'streetcar' | 'subway';
export type DirectionId = 0 | 1;

/** A vehicle was observed serving a directional boarding point (sla.md §2: the atom
 * everything else is derived from). */
export interface TouchEvent {
  /** Epoch ms, interval-censored to the ~30 s sampling cadence. */
  t: number;
  /** Directional GTFS stop id — directionality lives here, not in a side channel. */
  stopId: string;
  directionId: DirectionId;
  mode: ServiceMode;
  /** Flexity number or namespaced subway train id. */
  vehicleId: string;
  /** '506' vs '306' — day and night stay distinct identities. */
  routeId: string;
  /** Direction assignment was low-confidence. Diagnostic only; never displayed. */
  ambiguous?: boolean;
}

export type CoverageKind = 'observable' | 'outage' | 'no-reports';

/** What fraction of recent time the feeds could actually see (sla.md §3.6).
 * Feed outages are unmonitored time, never evidence of anything. */
export interface CoverageInterval {
  from: number;
  to: number;
  mode: ServiceMode;
  kind: CoverageKind;
}

/** One directional stop × one 5-minute bucket (sla.md §3.7, §4.3). `n, Σh, Σh²`
 * merge exactly across buckets; medians never do. */
export interface RollupRow {
  /** Epoch ms, floored to the 300 s bucket boundary. */
  bucketStart: number;
  stopId: string;
  /** Number of uncensored headways folded into the moments below: the
   * intra-bucket gaps plus the leading gap from the previous observed touch,
   * so that merged spans reproduce the raw-event moments exactly (§3.7).
   * (sla.md §4.3's comment calls this "touches"; §3.7's exact-merge math is
   * what tests assert, so n counts headways. Recorded in sla-chatter.md.) */
  n: number;
  /** Seconds. */
  headwaySum: number;
  /** Seconds². */
  headwaySumSq: number;
  maxGapSeconds: number;
  firstTouchAt: number | null;
  lastTouchAt: number | null;
  backToBack: number;
  distinctVehicles: number;
  /** Compact; 3xx night routes stay visible for labelling. */
  routeIds: string[];
  /** Was the feed watching this bucket? Bit per 30 s sub-slot of the 5 minutes. */
  coverageBits: number;
  /** Deterministic content hash: refolding an identical bucket reproduces it. */
  foldHash?: string;
}

export type ServiceStateKind = 'fresh' | 'due' | 'void' | 'unmonitored' | 'collecting';

export const SERVICE_STATES: readonly ServiceStateKind[] = [
  'fresh',
  'due',
  'void',
  'unmonitored',
  'collecting',
];

/** Coverage summary for one directional stop over the live window. */
export interface StopCoverageBadge {
  kind: CoverageKind;
  /** Unmonitored seconds inside the current window. */
  unmonitoredSeconds: number;
  /** When the current coverage run began (epoch ms). */
  since: number | null;
}

/** Live delivered-service state for one directional stop — the per-stop payload of
 * `GET /api/v1/service/stops` (sla.md story 3.1). Both truth axes are always
 * present: self-relative dryness AND absolute minutes. */
export interface StopServiceState {
  stopId: string;
  directionId: DirectionId;
  state: ServiceStateKind;
  lastTouchAt: number | null;
  /** Elapsed since last touch, minutes. The absolute axis; always present when
   * lastTouchAt is. */
  minutesSince: number | null;
  /** The stop's delivered baseline headway (gamma-approx median of recent
   * headways, stabilized by rollups in Stage 3). Approximation, labelled as such. */
  medianHeadwayOwnSeconds: number | null;
  /** CV² of recent headways — the bunching tax (sla.md §3.2). */
  irregularity: number | null;
  /** Residual wait R(e) for a rider who has already waited minutesSince
   * (sla.md §3.3). Null when no honest estimate exists. */
  expectedWaitSeconds: number | null;
  /** Self-relative dryness r = e / delivered-own-headway (sla.md §3.4). */
  dryness: number | null;
  /** Sub-45 s services in the window. Descriptive display only — never an input
   * to any decision (sla.md §3.5). */
  backToBack: number;
  coverage: StopCoverageBadge | null;
}

/** One route's windowed touches, delta-encoded for the replay/debug views
 * (sla.md story 3.2). Stop identity is an index into patternStopIds (the
 * space-time diagram's x-axis) and time is an offset from windowStart. */
export interface WaveTouch {
  stopIndex: number;
  /** Milliseconds after windowStart. */
  dt: number;
  vehicleId: string;
  directionId: DirectionId;
  mode: ServiceMode;
}

export interface ServiceWaveRoute {
  routeId: string;
  /** The pattern's direction — split routes keep the two directions
   * distinguishable in one payload (sla.md §3.8). */
  directionId: 0 | 1;
  /** Directional stop ids in pattern order. */
  patternStopIds: string[];
  touches: WaveTouch[];
}

export interface ServiceWaveResponse {
  schemaVersion: 1;
  windowStart: number;
  windowEnd: number;
  routes: ServiceWaveRoute[];
}

/** Merged-moment summary over any sub-window of the 36-hour history (sla.md
 * story 4.3). `n, Σh, Σh²` merge exactly; quantiles are gamma-approximations and
 * are named as approximations on the wire. */
export interface ServiceHistorySummary {
  stopId: string;
  n: number;
  meanHeadwaySeconds: number | null;
  irregularity: number | null;
  maxGapSeconds: number | null;
  backToBack: number;
  distinctVehicles: number;
  routeIds: string[];
  /** 0..1 — the observable fraction of the span. */
  coverageRatio: number;
  medianApproxSeconds: number | null;
  p90ApproxSeconds: number | null;
}

/** Per-bucket series for one stop (the sparkline's data, story 5.4). */
export interface ServiceHistoryStopBuckets {
  stopId: string;
  buckets: Array<{
    bucketStart: number;
    n: number;
    maxGapSeconds: number;
    backToBack: number;
  }>;
}

export interface ServiceHistoryResponse {
  schemaVersion: 1;
  from: number;
  to: number;
  summaries: ServiceHistorySummary[];
  /** Present for stop-scoped queries (`?stop=`): the 5-minute grain series. */
  bucketSeries?: ServiceHistoryStopBuckets[];
}

/** Per-user feature flags — `GET /api/v1/me/features` (sla-epics.md §0B). */
export interface FeatureFlagsResponse {
  schemaVersion: 1;
  flags: string[];
}

/** The debug overlay's flag (sla.md §4.7). Scaffolding shouldn't ship to everyone. */
export const VOID_OVERLAY_FLAG = 'voidOverlay';
