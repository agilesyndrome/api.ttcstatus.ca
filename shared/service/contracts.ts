/** SLA delivered-service contracts — the single vocabulary for worker, tests, and UI.
 * Background: docs/sla.md §4.3 (data model), §5 (stories E0S1, E3S1–E3S3, E4S3).
 * Pure types and tiny constants only: no I/O, no runtime dependencies.
 *
 * Units, everywhere: timestamps are epoch milliseconds (UTC); durations are
 * seconds. Any "day" rendering happens in the UI in America/Toronto.
 */

import type { SlaBandKind, ScheduledBand } from './sla-metrics';

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
  /** Routes serving this stop (served for filtering and context). */
  routeIds: string[];
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
  /** The window's coverage intervals — so the field can tell unmonitored
   * from unserviced at any moment, live or scrubbed (§3.6). */
  coverage: CoverageInterval[];
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

// ---------------------------------------------------------------------------
// SLA report — the promise lens, published (docs/sla-stories.md Epic 8).
// `GET /api/v1/sla/report` serves ONLY precomputed rows (the Tier 3 folds);
// it never derives compliance at request time. Compliance is time-weighted
// (sla-metrics.ts) and every tick is one data segment — there are exactly as
// many ticks as there are recorded segments, never a fabricated pre-history.
// ---------------------------------------------------------------------------

/** One box on a tick strip: a day (or week) of one route's or stop's record. */
export interface SlaTick {
  /** 'YYYY-MM-DD' (day grain) or the Monday key (week grain), Toronto. */
  key: string;
  /** 0..1, or null when the segment has no monitored gap time (no data). */
  compliance: number | null;
  band: SlaBandKind;
  /** Observed headways in the segment (the delivered services count). */
  services: number;
  /** Monitored gap time, minutes — the compliance denominator. */
  monitoredMinutes: number;
  maxGapSeconds: number | null;
  /** Observable share of the recorded 5-minute segments, 0..1. */
  coverageRatio: number;
  /** False only for the still-growing "today so far" segment. */
  final: boolean;
}

export interface SlaEntitySummary {
  compliance: number | null;
  band: SlaBandKind;
  monitoredMinutes: number;
  services: number;
  /** The newest day with data and its band — the row's "now" status. */
  latestDayKey: string | null;
  latestBand: SlaBandKind | null;
}

/** The published schedule promise, as compact hour bands (the schedule is
 * banded; the page states it in words, it does not draw a second chart).
 * Each class scores and displays on its own: weekends and holidays are
 * judged against the schedules the TTC publishes for them. */
export interface SlaPublishedSchedule {
  weekday: ScheduledBand[] | null;
  saturday: ScheduledBand[] | null;
  sunday: ScheduledBand[] | null;
  /** Present only when the feed publishes a distinct holiday schedule
   * (e.g., the Thanksgiving Monday class). */
  holiday: ScheduledBand[] | null;
}

export interface SlaRouteReport {
  routeId: string;
  number: string;
  name: string;
  /** 3xx night routes stay distinct identities (sla.md §3.4). */
  overnight: boolean;
  published: SlaPublishedSchedule;
  overall: SlaEntitySummary;
  days: SlaTick[];
  weeks: SlaTick[];
}

export interface SlaStopReport {
  stopId: string;
  name: string;
  directionId: DirectionId;
  /** The serving trips' headsign — "towards {headsign}". */
  headsign: string;
  routeIds: string[];
  overall: SlaEntitySummary;
  days: SlaTick[];
  weeks: SlaTick[];
}

export interface SlaReportResponse {
  schemaVersion: 1;
  generatedAt: number;
  /** Day key of the newest segment in the data (partial included). */
  dataThrough: string | null;
  targets: {
    /** The network version whose schedule produced the promises. */
    versionId: number;
    toleranceRatio: number;
    metRatio: number;
    degradedRatio: number;
  };
  /** Whole-report roll-up (merged over the route rows — corridor-shared
   * stops contribute to each route they serve; documented on the page). */
  overall: SlaEntitySummary;
  routes: SlaRouteReport[];
  /** Present for `?route=`: that route's directional stops. */
  stops?: SlaStopReport[];
}

/** The debug overlay's flag (sla.md §4.7). Scaffolding shouldn't ship to everyone. */
export const VOID_OVERLAY_FLAG = 'voidOverlay';
