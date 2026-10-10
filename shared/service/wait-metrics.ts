/** The math: one pure, exhaustively-tested statistics module (sla.md §3, Epic 2).
 * Every number the system shows is computed here — server, tests, and UI agree
 * because they share this code. No I/O, ever.
 *
 * Conventions: timestamps epoch ms; durations seconds; per DIRECTIONAL stop
 * (sla.md §3.8). Censoring per §3.6; moments per §3.7; the §3.2 renewal wait;
 * the §3.3 residual; the §3.4 two-axis dryness. The ground truth for all of it
 * is the corpus in shared/service/fixtures.ts, whose expected values were
 * derived by hand, never by this module.
 */

import type {
  CoverageInterval,
  CoverageKind,
  RollupRow,
  StopServiceState,
  TouchEvent,
} from './contracts';
import type { ServiceConfig } from './config';

// ---------------------------------------------------------------------------
// Coverage (sla.md §3.6): what fraction of recent time the feeds could see.
// Unmonitored time is never evidence of anything.
// ---------------------------------------------------------------------------

const COVERAGE_UNMONITORED = ['outage', 'no-reports'] as const;
export const UNMONITORED_KINDS: readonly CoverageKind[] = COVERAGE_UNMONITORED;

export interface CoverageSummary {
  /** Seconds inside [windowStart, at] the feeds could observe this mode. */
  observableSeconds: number;
  /** Seconds inside the window the feeds could not (outage + no-reports). */
  unmonitoredSeconds: number;
  /** The kind of the interval containing `at` ('observable' when uncovered). */
  currentKind: CoverageKind;
  /** When the current coverage run began (epoch ms), if it is unmonitored. */
  currentSince: number | null;
}

export function coverageSummary(
  coverage: CoverageInterval[],
  mode: TouchEvent['mode'],
  windowStart: number,
  at: number,
): CoverageSummary {
  const relevant = coverage
    .filter((interval) => interval.mode === mode)
    .map((interval) => ({
      kind: interval.kind,
      from: Math.max(interval.from, windowStart),
      to: Math.min(interval.to, at),
    }))
    .filter((interval) => interval.to > interval.from)
    .sort((a, b) => a.from - b.from);
  let observable = 0;
  const unmonitored: Array<{ from: number; to: number; kind: CoverageKind }> = [];
  for (const interval of relevant) {
    if (interval.kind === 'observable') {
      observable += (interval.to - interval.from) / 1000;
    } else {
      const last = unmonitored[unmonitored.length - 1];
      // Merge overlapping/adjacent unmonitored runs of either kind.
      if (last && interval.from <= last.to) {
        last.to = Math.max(last.to, interval.to);
      } else {
        unmonitored.push({ ...interval });
      }
    }
  }
  const unmonitoredSeconds = unmonitored.reduce(
    (total, run) => total + (run.to - run.from) / 1000,
    0,
  );
  const current = relevant.find((interval) => interval.from <= at && at <= interval.to);
  return {
    observableSeconds: Math.max(0, Math.round(observable)),
    unmonitoredSeconds: Math.max(0, Math.round(unmonitoredSeconds)),
    currentKind: current?.kind ?? 'observable',
    currentSince:
      current && current.kind !== 'observable'
        ? (unmonitored.find((run) => run.from <= at && at <= run.to)?.from ?? null)
        : null,
  };
}

/** Does [from, to] overlap any unmonitored time for this mode? A gap that
 * crosses a blind spot is interval-censored: we cannot know how many touches
 * hid inside the dark, so it never enters the moment sums. */
function overlapsUnmonitored(
  coverage: CoverageInterval[],
  mode: TouchEvent['mode'],
  from: number,
  to: number,
): boolean {
  return coverage.some(
    (interval) =>
      interval.mode === mode &&
      interval.kind !== 'observable' &&
      interval.from < to &&
      interval.to > from,
  );
}

// ---------------------------------------------------------------------------
// E2S1 — headway extraction with censoring (sla.md §3.6).
// ---------------------------------------------------------------------------

export interface HeadwaySample {
  /** Uncensored headway seconds, in order. */
  headways: number[];
  /** Gaps excluded from the moments: window-edge, blind-spot, and the
   * still-open ongoing gap. They count toward coverage instead. */
  censoredCount: number;
  /** In-window touch times, epoch ms, ascending. */
  times: number[];
  touchCount: number;
  lastTouchAt: number | null;
  coverage: CoverageSummary;
  mode: TouchEvent['mode'];
}

/** Compute one directional stop's headway sample over the window.
 * `touches` must all belong to the same directional stop. */
export function headwaysForStop(
  touches: TouchEvent[],
  coverage: CoverageInterval[],
  windowStart: number,
  at: number,
): HeadwaySample {
  const mode = touches[0]?.mode ?? 'streetcar';
  const times = touches
    .map((touch) => touch.t)
    .filter((t) => windowStart <= t && t <= at)
    .sort((a, b) => a - b);
  const headways: number[] = [];
  let censored = 0;
  // Left-censoring: the window opened before the first observed touch — we did
  // not see the touch that preceded the window (sla.md §3.6).
  if (times.length > 0 && times[0] > windowStart) censored += 1;
  for (let index = 1; index < times.length; index += 1) {
    const seconds = (times[index] - times[index - 1]) / 1000;
    if (overlapsUnmonitored(coverage, mode, times[index - 1], times[index])) {
      censored += 1;
    } else {
      headways.push(seconds);
    }
  }
  // Right-censoring: the ongoing gap is still growing.
  if (times.length > 0 && times[times.length - 1] < at) censored += 1;
  return {
    headways,
    censoredCount: censored,
    times,
    touchCount: times.length,
    lastTouchAt: times.length > 0 ? times[times.length - 1] : null,
    coverage: coverageSummary(coverage, mode, windowStart, at),
    mode,
  };
}

/** Group touches by directional stop id. Order of groups is insertion order. */
export function groupTouchesByStop(touches: TouchEvent[]): Map<string, TouchEvent[]> {
  const byStop = new Map<string, TouchEvent[]>();
  for (const touch of touches) {
    const bucket = byStop.get(touch.stopId);
    if (bucket) bucket.push(touch);
    else byStop.set(touch.stopId, [touch]);
  }
  return byStop;
}

// ---------------------------------------------------------------------------
// E2S2 — moments and the renewal wait (sla.md §3.2).
// ---------------------------------------------------------------------------

export interface Moments {
  n: number;
  /** Σh, seconds. */
  sum: number;
  /** Σh², seconds². */
  sumSq: number;
}

export function moments(headways: number[]): Moments {
  let sum = 0;
  let sumSq = 0;
  for (const headway of headways) {
    sum += headway;
    sumSq += headway * headway;
  }
  return { n: headways.length, sum, sumSq };
}

export function meanHeadwaySeconds(sample: Moments): number | null {
  return sample.n > 0 ? sample.sum / sample.n : null;
}

/** CV² = Var(H)/E[H]² — the bunching tax. Null with fewer than two samples. */
export function cvSquared(sample: Moments): number | null {
  if (sample.n < 2 || sample.sum <= 0) return null;
  const mean = sample.sum / sample.n;
  const meanSq = sample.sumSq / sample.n;
  const variance = meanSq - mean * mean;
  return variance <= 0 ? 0 : variance / (mean * mean);
}

/** E[W] = Σh² / 2Σh — the waiting-time paradox (sla.md §3.2). Same average
 * headway, wildly different average wait, purely from variance. */
export function renewalWaitSeconds(headways: number[]): number | null {
  return renewalWaitFromMoments(moments(headways));
}

export function renewalWaitFromMoments(sample: Moments): number | null {
  return sample.sum > 0 ? sample.sumSq / (2 * sample.sum) : null;
}

/** The baseline's own E[W] via §3.2: (H̄/2)·(1 + CV²). This is the shrinkage
 * target for thin windows. */
export function baselineExpectedWaitSeconds(baseline: {
  meanSeconds: number;
  cv2: number | null;
}): number {
  return (baseline.meanSeconds / 2) * (1 + (baseline.cv2 ?? 0));
}

/** Small-sample shrinkage toward the delivered baseline (story 2.2): blend
 * with weight n/(n+prior). At Stage 1 the baseline IS the window sample, so
 * this is a no-op by construction; Stage 3 (E2S9) feeds it rollup moments and
 * it becomes a real stabilizer. No baseline → the estimate stands alone. */
export function shrinkTowardBaseline(
  estimate: number,
  n: number,
  baselineExpectedWait: number | null,
  prior: number,
): number {
  if (baselineExpectedWait === null || prior <= 0 || n <= 0) return estimate;
  const weight = n / (n + prior);
  return weight * estimate + (1 - weight) * baselineExpectedWait;
}

// ---------------------------------------------------------------------------
// E2S3 — the residual wait R(e) (sla.md §3.3), with gamma method-of-moments
// smoothing for thin samples. Under even service R(e) counts down to zero;
// under bunched service it grows — the felt experience of a wave of void.
// ---------------------------------------------------------------------------

export function residualWaitSeconds(
  headways: number[],
  e: number,
  minSamples: number,
): number | null {
  if (headways.length === 0) return null;
  const exceed = headways.filter((headway) => headway > e);
  if (exceed.length >= minSamples) {
    // Empirical estimator: R(e) = Σ(hᵢ − e)⁺ / #{hᵢ > e}.
    const total = exceed.reduce((sum, headway) => sum + (headway - e), 0);
    return total / exceed.length;
  }
  const sample = moments(headways);
  if (sample.n === 0 || sample.sum <= 0) return null;
  const mean = sample.sum / sample.n;
  const variance = sample.n >= 2 ? sample.sumSq / sample.n - mean * mean : 0;
  if (!(variance > 1e-9)) {
    // Degenerate (even) service: the next car comes exactly on schedule.
    return Math.max(mean - e, 0);
  }
  // Gamma method-of-moments: shape k = H̄²/Var, scale θ = Var/H̄.
  const k = (mean * mean) / variance;
  const theta = variance / mean;
  const survival = 1 - gammaCdf(e / theta, k);
  if (!(survival > 1e-12)) return 0;
  // E[(H − e)⁺] under Gamma(k, θ) = kθ·S(e; k+1) − e·S(e; k), where S is the
  // survival function; R(e) = that divided by P(H > e) = S(e; k).
  const expectedExcess = k * theta * (1 - gammaCdf(e / theta, k + 1)) - e * survival;
  return Math.max(0, expectedExcess / survival);
}

// ---------------------------------------------------------------------------
// E2S4 — two-axis dryness and the five states (sla.md §3.4).
// ---------------------------------------------------------------------------

export interface DrynessState {
  dryness: number | null;
  state: 'fresh' | 'due' | 'void' | 'unmonitored' | 'collecting';
}

/** r = e / H̄_own on the self-relative axis, absolute minutes always present.
 * Precedence: unmonitored beats everything (never fabricate a void); a stop
 * without a baseline is collecting; then void (ratio OR absolute), due, fresh. */
export function drynessAndState(
  inputs: {
    minutesSince: number | null;
    medianHeadwayOwnSeconds: number | null;
    currentlyObservable: boolean;
    touchCount: number;
    baselineTouches: number;
  },
  config: Pick<
    ServiceConfig,
    'freshDrynessRatio' | 'voidDrynessRatio' | 'voidAbsoluteMinutes'
  >,
): DrynessState {
  if (!inputs.currentlyObservable) return { dryness: null, state: 'unmonitored' };
  if (inputs.touchCount < inputs.baselineTouches)
    return { dryness: null, state: 'collecting' };
  if (inputs.medianHeadwayOwnSeconds === null || inputs.minutesSince === null) {
    return { dryness: null, state: 'collecting' };
  }
  const elapsed = inputs.minutesSince * 60;
  const dryness = elapsed / inputs.medianHeadwayOwnSeconds;
  if (elapsed >= config.voidAbsoluteMinutes * 60 || dryness >= config.voidDrynessRatio) {
    return { dryness, state: 'void' };
  }
  if (dryness < config.freshDrynessRatio) return { dryness, state: 'fresh' };
  return { dryness, state: 'due' };
}

// ---------------------------------------------------------------------------
// E2S5 — the back-to-back marker (sla.md §3.5). Descriptive display only; it
// is never an input to any decision.
// ---------------------------------------------------------------------------

/** Consecutive in-window touches under `thresholdSeconds`, including
 * same-sample dual touches (Δ = 0). */
export function backToBackCount(
  touchTimesMs: number[],
  thresholdSeconds: number,
): number {
  const times = [...touchTimesMs].sort((a, b) => a - b);
  let count = 0;
  for (let index = 1; index < times.length; index += 1) {
    if ((times[index] - times[index - 1]) / 1000 < thresholdSeconds) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// E2S6 — the delivered baseline: a stop's own recent headway statistics
// (sla.md §2). Not a schedule; not a promise. Window tier at Stage 1; the
// interface takes a baseline *source* so E2S9 can stabilize on rollups.
// ---------------------------------------------------------------------------

export interface WindowBaseline {
  tier: 'window';
  /** Empirical median of uncensored headways, seconds. */
  medianSeconds: number;
  meanSeconds: number;
  cv2: number | null;
  /** Moments of the uncensored headways — mergeable, exact. */
  moments: Moments;
  touches: number;
}

/** Empirical median: middle value, or the average of the two middle values. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function windowBaseline(
  sample: HeadwaySample,
  baselineMinTouches: number,
): WindowBaseline | null {
  if (sample.touchCount < baselineMinTouches || sample.headways.length === 0) return null;
  const headwayMoments = moments(sample.headways);
  return {
    tier: 'window',
    medianSeconds: median(sample.headways) as number,
    meanSeconds: meanHeadwaySeconds(headwayMoments) as number,
    cv2: cvSquared(headwayMoments),
    moments: headwayMoments,
    touches: sample.touchCount,
  };
}

// ---------------------------------------------------------------------------
// Live assembly: the per-stop state served by /api/v1/service/stops (E3S1).
// ---------------------------------------------------------------------------

export interface StateAssemblyOptions {
  windowStart: number;
  at: number;
  config: ServiceConfig;
  /** Stage 3 (E2S9): a stabilized baseline for stops whose window is thin. */
  stabilized?: (stopId: string) => { medianSeconds: number; moments: Moments } | null;
}

export function stopServiceState(
  stopId: string,
  touches: TouchEvent[],
  coverage: CoverageInterval[],
  options: StateAssemblyOptions,
): StopServiceState {
  const { config } = options;
  const sample = headwaysForStop(touches, coverage, options.windowStart, options.at);
  const directionId = touches[0]?.directionId ?? 0;
  const baseline = windowBaseline(sample, config.baselineMinTouches);
  const stabilized = baseline ? null : (options.stabilized?.(stopId) ?? null);
  const medianSeconds = baseline?.medianSeconds ?? stabilized?.medianSeconds ?? null;
  const minutesSince =
    sample.lastTouchAt !== null ? (options.at - sample.lastTouchAt) / 60000 : null;
  const { dryness, state } = drynessAndState(
    {
      minutesSince,
      medianHeadwayOwnSeconds: medianSeconds,
      currentlyObservable: sample.coverage.currentKind === 'observable',
      touchCount: sample.touchCount,
      // A rollup-stabilized baseline satisfies the collecting threshold
      // (E2S9): the stop's 36 hours of history speak even when its window
      // is thin.
      baselineTouches: stabilized ? 0 : config.baselineMinTouches,
    },
    config,
  );
  const headwayMoments = moments(sample.headways);
  return {
    stopId,
    directionId,
    state,
    lastTouchAt: sample.lastTouchAt,
    minutesSince,
    medianHeadwayOwnSeconds: medianSeconds,
    irregularity: cvSquared(headwayMoments),
    expectedWaitSeconds:
      sample.headways.length > 0 && minutesSince !== null
        ? residualWaitSeconds(
            sample.headways,
            minutesSince * 60,
            config.residualMinSamples,
          )
        : null,
    dryness,
    backToBack: backToBackCount(sample.times, config.backToBackSeconds),
    routeIds: [...new Set(touches.map((touch) => touch.routeId))].sort(),
    coverage: {
      kind: sample.coverage.currentKind,
      unmonitoredSeconds: sample.coverage.unmonitoredSeconds,
      since: sample.coverage.currentSince,
    },
  };
}

/** All directional stops' live states in one call — the shape the recorder
 * computes once per tick and the API serves. */
export function serviceStatesAt(
  touches: TouchEvent[],
  coverage: CoverageInterval[],
  options: StateAssemblyOptions,
): Map<string, StopServiceState> {
  const states = new Map<string, StopServiceState>();
  for (const [stopId, stopTouches] of groupTouchesByStop(touches)) {
    states.set(stopId, stopServiceState(stopId, stopTouches, coverage, options));
  }
  return states;
}

// ---------------------------------------------------------------------------
// E2S7 — moment merging for rollups (sla.md §3.7). Moments merge exactly;
// medians never do; quantiles are gamma approximations, labelled as such.
// ---------------------------------------------------------------------------

export interface MergedRollups {
  rows: number;
  n: number;
  sum: number;
  sumSq: number;
  /** Worst intra-bucket gap, seconds. */
  maxGapSeconds: number | null;
  /** Worst cross-bucket wound (next bucket's first touch − previous bucket's
   * last touch, over consecutive activity rows), seconds (sla.md §3.7). */
  maxCrossGapSeconds: number | null;
  backToBack: number;
  distinctVehicles: number;
  routeIds: string[];
  firstTouchAt: number | null;
  lastTouchAt: number | null;
  coverageBits: number;
  coverageSlots: number;
}

export function mergeRollupRows(rows: RollupRow[]): MergedRollups {
  const merged: MergedRollups = {
    rows: rows.length,
    n: 0,
    sum: 0,
    sumSq: 0,
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
  if (rows.length === 0) return merged;
  const routes = new Set<string>();
  let maxGap: number | null = null;
  let first: number | null = null;
  let last: number | null = null;
  for (const row of rows) {
    merged.n += row.n;
    merged.sum += row.headwaySum;
    merged.sumSq += row.headwaySumSq;
    merged.backToBack += row.backToBack;
    merged.distinctVehicles += row.distinctVehicles;
    merged.coverageBits |= row.coverageBits;
    merged.coverageSlots += 10;
    if (row.maxGapSeconds > 0 && (maxGap === null || row.maxGapSeconds > maxGap)) {
      maxGap = row.maxGapSeconds;
    }
    if (row.firstTouchAt !== null && (first === null || row.firstTouchAt < first)) {
      first = row.firstTouchAt;
    }
    if (row.lastTouchAt !== null && (last === null || row.lastTouchAt > last)) {
      last = row.lastTouchAt;
    }
    for (const route of row.routeIds) routes.add(route);
  }
  // Cross-bucket wounds: consecutive activity rows, in bucket order.
  const ordered = [...rows].sort((a, b) => a.bucketStart - b.bucketStart);
  let maxCross: number | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = crossBucketGapSeconds(ordered[index - 1], ordered[index]);
    if (gap !== null && (maxCross === null || gap > maxCross)) maxCross = gap;
  }
  return {
    ...merged,
    maxGapSeconds: maxGap,
    maxCrossGapSeconds: maxCross,
    firstTouchAt: first,
    lastTouchAt: last,
    routeIds: [...routes].sort(),
  };
}

/** A wound spanning buckets is reconstructed as the next bucket's first touch
 * minus this bucket's last touch (sla.md §3.7). */
export function crossBucketGapSeconds(left: RollupRow, right: RollupRow): number | null {
  if (left.lastTouchAt === null || right.firstTouchAt === null) return null;
  return (right.firstTouchAt - left.lastTouchAt) / 1000;
}

/** The worst wound in the span, either kind (used by history summaries). */
export function worstGapSeconds(merged: MergedRollups): number | null {
  const candidates = [merged.maxGapSeconds, merged.maxCrossGapSeconds].filter(
    (value): value is number => value !== null,
  );
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

export function mergedMeanSeconds(merged: MergedRollups): number | null {
  return merged.n > 0 ? merged.sum / merged.n : null;
}

export function mergedCvSquared(merged: MergedRollups): number | null {
  if (merged.n < 1 || merged.sum <= 0) return null;
  const mean = merged.sum / merged.n;
  if (merged.n < 2) return 0;
  const meanSq = merged.sumSq / merged.n;
  const variance = meanSq - mean * mean;
  return variance <= 0 ? 0 : variance / (mean * mean);
}

/** Gamma-approximation quantile, clearly labelled an approximation everywhere
 * it is exposed. Falls back to the mean when variance ~ 0 (even service). */
export function gammaApproxQuantileSeconds(
  merged: MergedRollups,
  quantile: number,
): number | null {
  const mean = mergedMeanSeconds(merged);
  if (mean === null) return null;
  const cv2 = mergedCvSquared(merged);
  if (cv2 === null || cv2 <= 1e-9) return mean;
  const variance = cv2 * mean * mean;
  const k = (mean * mean) / variance;
  const theta = variance / mean;
  const x = gammaQuantile(quantile, k) * theta;
  return x;
}

// ---------------------------------------------------------------------------
// Fold derivation (E4S1): one bucket of touches + coverage → one deterministic
// RollupRow. Same inputs, same row, byte-identical — idempotency by
// construction. Pure, so a DO restart that re-derives a bucket from surviving
// raw rows reproduces the identical row.
// ---------------------------------------------------------------------------

export const BUCKET_SUBSLOTS = 10; // 300 s bucket / 30 s slots

/** FNV-1a 64-bit over the canonical row content — a deterministic content
 * hash for refold verification. Not cryptographic; it doesn't need to be:
 * the row itself is the evidence, the hash is the tripwire. */
export function foldHash(parts: Array<string | number | null>): string {
  let hash = 0xcbf29ce484222325n;
  for (const part of parts) {
    const text = part === null ? '\u0000' : String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= BigInt(text.charCodeAt(index));
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    hash ^= 0x1fn;
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function bucketStartFor(t: number, bucketSeconds: number): number {
  return Math.floor(t / (bucketSeconds * 1000)) * bucketSeconds * 1000;
}

/** Derive one directional stop's rollup row for the bucket starting at
 * `bucketStart`. Touches must belong to one stop; `previousTouchAt` is the
 * last observed touch strictly before the bucket (from the window store —
 * still present at fold time), or null when the record begins here.
 *
 * The moment sums cover every consecutive touch pair exactly once: the
 * leading gap (previous observed touch → this bucket's first) plus the
 * intra-bucket gaps, each censored independently per §3.6. That is what
 * makes a merged span reproduce the raw-event moments exactly (§3.7) — a
 * 19-minute bunch gap crossing a bucket boundary is never lost. Same inputs,
 * same row, byte-identical: idempotency by construction. */
export function deriveRollupRow(
  stopId: string,
  bucketStart: number,
  bucketSeconds: number,
  touches: TouchEvent[],
  coverage: CoverageInterval[],
  previousTouchAt: number | null,
): RollupRow {
  const bucketEnd = bucketStart + bucketSeconds * 1000;
  const inBucket = touches
    .filter(
      (touch) => touch.stopId === stopId && touch.t >= bucketStart && touch.t < bucketEnd,
    )
    .sort((a, b) => a.t - b.t);
  const mode = inBucket[0]?.mode ?? 'streetcar';
  const headways: number[] = [];
  const chain: number[] = [];
  if (
    inBucket.length > 0 &&
    previousTouchAt !== null &&
    previousTouchAt < inBucket[0].t
  ) {
    // The leading gap — unless it crosses unmonitored time, in which case it
    // is censored like any other blind-spot gap.
    if (!overlapsUnmonitored(coverage, mode, previousTouchAt, inBucket[0].t)) {
      headways.push((inBucket[0].t - previousTouchAt) / 1000);
    }
    chain.push(previousTouchAt);
  }
  for (let index = 1; index < inBucket.length; index += 1) {
    if (!overlapsUnmonitored(coverage, mode, inBucket[index - 1].t, inBucket[index].t)) {
      headways.push((inBucket[index].t - inBucket[index - 1].t) / 1000);
    }
  }
  chain.push(...inBucket.map((touch) => touch.t));
  const headwayMoments = moments(headways);
  let maxGap = 0;
  for (const headway of headways) maxGap = Math.max(maxGap, headway);
  // Coverage bits: one bit per 30 s sub-slot; a slot counts as watched only if
  // it was observable for its whole duration (conservative honesty).
  let coverageBits = 0;
  const slotMs = (bucketSeconds / BUCKET_SUBSLOTS) * 1000;
  for (let slot = 0; slot < BUCKET_SUBSLOTS; slot += 1) {
    const from = bucketStart + slot * slotMs;
    const to = from + slotMs;
    const blind = coverage.some(
      (interval) =>
        interval.mode === mode &&
        interval.kind !== 'observable' &&
        interval.from < to &&
        interval.to > from,
    );
    if (!blind) coverageBits |= 1 << slot;
  }
  const routeIds = [...new Set(inBucket.map((touch) => touch.routeId))].sort();
  const vehicles = new Set(inBucket.map((touch) => touch.vehicleId));
  // Back-to-back over the full consecutive-touch chain (a pair straddling the
  // bucket boundary is still a pair).
  const b2bThreshold = 45;
  let b2b = 0;
  for (let index = 1; index < chain.length; index += 1) {
    if ((chain[index] - chain[index - 1]) / 1000 < b2bThreshold) b2b += 1;
  }
  const firstTouchAt = inBucket.length > 0 ? inBucket[0].t : null;
  const lastTouchAt = inBucket.length > 0 ? inBucket[inBucket.length - 1].t : null;
  return {
    bucketStart,
    stopId,
    n: headwayMoments.n,
    headwaySum: headwayMoments.sum,
    headwaySumSq: headwayMoments.sumSq,
    maxGapSeconds: maxGap,
    firstTouchAt,
    lastTouchAt,
    backToBack: b2b,
    distinctVehicles: vehicles.size,
    routeIds,
    coverageBits,
    foldHash: foldHash([
      stopId,
      bucketStart,
      headwayMoments.n,
      headwayMoments.sum,
      headwayMoments.sumSq,
      maxGap,
      firstTouchAt,
      lastTouchAt,
      b2b,
      vehicles.size,
      routeIds.join(','),
      coverageBits,
    ]),
  };
}

// ---------------------------------------------------------------------------
// Gamma machinery: regularized lower incomplete gamma P(a,x) and its inverse,
// after Numerical Recipes (public-domain formulations). Used only for the
// §3.3 smoothing and the labelled §3.7 quantile approximations.
// ---------------------------------------------------------------------------

const GAMMA_LN_COEFFICIENTS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
  0.1208650973866179e-2, -0.5395239384953e-5,
];

function gammaLn(x: number): number {
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let series = 1.000000000190015;
  for (const coefficient of GAMMA_LN_COEFFICIENTS) {
    y += 1;
    series += coefficient / y;
  }
  return -tmp + Math.log((2.5066282746310005 * series) / x);
}

function gammaSeries(a: number, x: number): number {
  // P(a,x) via the series expansion — converges for x < a + 1.
  let sum = 1 / a;
  let delta = sum;
  let ap = a;
  for (let n = 1; n < 1000; n += 1) {
    ap += 1;
    delta *= x / ap;
    sum += delta;
    if (Math.abs(delta) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a));
}

function gammaContinuedFraction(a: number, x: number): number {
  // Q(a,x) = 1 − P(a,x) via the modified Lentz continued fraction.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
}

/** Regularized lower incomplete gamma P(a, x) = γ(a,x)/Γ(a). */
export function gammaCdf(x: number, a: number): number {
  if (!(a > 0) || x < 0) return Number.NaN;
  if (x === 0) return 0;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

/** Inverse of gammaCdf for a fixed shape a: find x where P(a, x) = q. */
export function gammaQuantile(q: number, a: number): number {
  if (!(a > 0) || q <= 0) return 0;
  if (q >= 1) return Infinity;
  let low = 0;
  let high = 1;
  while (gammaCdf(high, a) < q) high *= 2;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    if (gammaCdf(mid, a) < q) low = mid;
    else high = mid;
    if (high - low < 1e-9 * Math.max(1, high)) break;
  }
  return (low + high) / 2;
}
