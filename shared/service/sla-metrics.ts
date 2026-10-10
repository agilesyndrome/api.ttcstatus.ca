/** The promise lens (docs/sla-stories.md Epic 8; docs/sla.md §11's future hook,
 * shipped as the user's /sla page). Pure statistics only — no I/O, ever — so
 * worker, tests, and UI agree on every number.
 *
 * The question this module answers: given a span of *delivered* headway
 * moments (the mergeable `n, Σh, Σh²` every other layer already trusts) and a
 * *scheduled* headway θ — the SLA the TTC's own static schedule indicates —
 * how much of the monitored time was within the SLA?
 *
 * Compliance is time-weighted, not count-weighted: a rider standing inside a
 * gap experiences that whole gap, so the honest denominator is Σh (the total
 * gap time observed) and the honest numerator is the fraction of that time in
 * gaps at or under θ·tolerance. Time-weighting is also what makes the parts
 * exactly additive across buckets, hours, days, weeks, stops and routes —
 * every rollup in the /sla pipeline is a sum of these two numbers.
 *
 * The within-θ share of gap time is estimated from the merged moments with the
 * same gamma method-of-moments machinery as the history quantiles (sla.md
 * §3.7) and is labelled an approximation everywhere it is exposed, exactly
 * like them. Clockwork service (CV² ≈ 0) degenerates to the exact answer.
 *
 * Honesty rules carried through from the delivered pipeline (sla.md §3.6):
 * spans with no observed headways have no monitored time and report no
 * compliance — unmonitored time never counts for or against the SLA. */

import { gammaCdf, median } from './wait-metrics';

/** Mergeable delivered-moment triple: same shape as the rollup moments. */
export interface SlaMoments {
  n: number;
  /** Σh, seconds. */
  sum: number;
  /** Σh², seconds². */
  sumSq: number;
}

/** The two additive numbers every SLA rollup stores. `gapSeconds` is the
 * monitored gap time observed (the denominator); `compliantSeconds` is the
 * estimated share of it inside the SLA (the numerator). */
export interface SlaComplianceParts {
  gapSeconds: number;
  compliantSeconds: number;
}

export type SlaBandKind = 'met' | 'degraded' | 'missed' | 'no-data';

/** θ = the scheduled headway × tolerance. A car within θ of the last one
 * counts as within the SLA; the tolerance's default (1.5) says a bunched pair
 * followed by a 1.5× gap is still met — the waiting-time paradox, not the
 * timetable, is what the rider feels. Provisional, config-owned, recorded in
 * sla.md §9. */
export function slaThresholdSeconds(
  scheduledHeadwaySeconds: number,
  toleranceRatio: number,
): number {
  return scheduledHeadwaySeconds * toleranceRatio;
}

/** Estimated gap-time inside the SLA for one merged span of moments.
 *
 * E[min(H, θ)] per gap under the gamma-MoM fit: for gamma(k, s),
 * E[(H−θ)⁺] = s·k·Q(k+1, θ/s) − θ·Q(k, θ/s), so
 * E[min(H, θ)] = E[H] − E[(H−θ)⁺] with E[H] = s·k.
 * Degenerate variance (clockwork) is exact: min(H̄, θ) per gap.
 * Returns null when there is nothing honest to say (no observed headways, or
 * no promise to compare against). */
export function slaComplianceParts(
  moments: SlaMoments,
  thresholdSeconds: number,
): SlaComplianceParts | null {
  const { n, sum, sumSq } = moments;
  if (!(n > 0) || !(sum > 0) || !(thresholdSeconds > 0)) return null;
  const mean = sum / n;
  if (!(mean > 0)) return null;
  const variance = sumSq / n - mean * mean;
  let expectedMin: number;
  if (!(variance > 0)) {
    // Clockwork: every gap is H̄ — exact, not approximate.
    expectedMin = Math.min(mean, thresholdSeconds);
  } else {
    const shape = (mean * mean) / variance; // k
    const scale = variance / mean; // s
    const x = thresholdSeconds / scale;
    // Q(a, x) = 1 − P(a, x) from the shared gamma machinery.
    const qK = 1 - gammaCdf(x, shape);
    const qKNext = 1 - gammaCdf(x, shape + 1);
    const overThreshold = scale * shape * qKNext - thresholdSeconds * qK;
    expectedMin = mean - Math.max(overThreshold, 0);
  }
  const compliantSeconds = Math.min(Math.max(n * expectedMin, 0), sum);
  return { gapSeconds: sum, compliantSeconds };
}

/** Parts merge exactly — this is what makes day → week → route rollups a sum. */
export function mergeSlaParts(parts: SlaComplianceParts[]): SlaComplianceParts {
  let gapSeconds = 0;
  let compliantSeconds = 0;
  for (const part of parts) {
    gapSeconds += part.gapSeconds;
    compliantSeconds += part.compliantSeconds;
  }
  return { gapSeconds, compliantSeconds };
}

/** Compliance ratio, 0..1, or null when there is no monitored gap time —
 * rendered as no-data, never as 0%. */
export function slaComplianceRatio(parts: SlaComplianceParts): number | null {
  if (!(parts.gapSeconds > 0)) return null;
  return Math.min(Math.max(parts.compliantSeconds / parts.gapSeconds, 0), 1);
}

/** The green / yellow / red banding shared by API and UI (config thresholds,
 * no magic numbers here). */
export function slaBandFor(
  ratio: number | null,
  metRatio: number,
  degradedRatio: number,
): SlaBandKind {
  if (ratio === null) return 'no-data';
  if (ratio >= metRatio) return 'met';
  if (ratio >= degradedRatio) return 'degraded';
  return 'missed';
}

// ---------------------------------------------------------------------------
// Scheduled headway derivation from GTFS departures (Epic 8, story E8S1)
// ---------------------------------------------------------------------------

/** The TTC's advertised grid (user steer, 2026-10-10; recorded in sla.md §9):
 * headways publish as multiples of five minutes from ten upward — the TTC
 * never advertises better than 10 minutes, even where the schedule offers
 * it. A 5-minute corridor publishes "every 10 min"; 8–12 publishes 10,
 * 13–17 publishes 15, 18–22 publishes 20. Scoring uses the same advertised
 * target, so the published promise and θ can never disagree. */
export function advertisedHeadwaySeconds(scheduledSeconds: number): number {
  const minutes = scheduledSeconds / 60;
  if (!(minutes > 0)) return scheduledSeconds;
  return Math.max(10, Math.round(minutes / 5) * 5) * 60;
}

/** Scheduled headway per hour-of-day band, from one service class's pooled
 * departure times (seconds since noon-minus-12h, GTFS convention — values may
 * exceed 24 h for overnight trips; hour 25 is next day's hour 1).
 *
 * A gap is attributed to the hour of the departure that started it: the
 * band's promise is "a car came at h:mm — the next is scheduled θ later."
 * Hours with no scheduled departures carry no promise and report null.
 * Gaps are rounded to whole seconds for determinism; medians (not means)
 * because one inserted tripper must not move a corridor's published promise;
 * and the median lands on the advertised grid (see above), because the
 * promise we publish is the promise the TTC itself advertises. */
export function hourlyScheduledHeadways(
  departureSeconds: number[],
): Array<number | null> {
  const byBand: number[][] = Array.from({ length: 24 }, () => []);
  const sorted = [...departureSeconds].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const gap = Math.round(sorted[index] - previous);
    if (gap <= 0) continue;
    byBand[Math.floor(previous / 3600) % 24].push(gap);
  }
  return byBand.map((gaps) => {
    const value = median(gaps);
    return value === null ? null : advertisedHeadwaySeconds(value);
  });
}

/** Merge adjacent hours of a headway band array into contiguous runs of
 * (near-)equal promise — the compact form the page publishes as "the SLA the
 * TTC indicates" (e.g. 6:00–19:00 every ~5 min). */
export interface ScheduledBand {
  fromHour: number;
  toHour: number; // exclusive
  headwaySeconds: number;
}

export function scheduledBands(
  hourly: Array<number | null>,
  toleranceSeconds = 30,
): ScheduledBand[] {
  const bands: ScheduledBand[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const headway = hourly[hour];
    if (headway === null || headway <= 0) continue;
    const previous = bands.at(-1);
    // Extend only across ADJACENT hours with a (near-)equal promise — the
    // advertised grid makes equal values common, and merging across a
    // service gap would claim service the schedule does not publish.
    if (
      previous &&
      previous.toHour === hour &&
      Math.abs(previous.headwaySeconds - headway) <= toleranceSeconds
    ) {
      previous.toHour = hour + 1;
    } else {
      bands.push({ fromHour: hour, toHour: hour + 1, headwaySeconds: headway });
    }
  }
  return bands;
}

// ---------------------------------------------------------------------------
// Toronto time (house rule: internal epoch ms; any "day" in America/Toronto)
// ---------------------------------------------------------------------------

const TORONTO_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'YYYY-MM-DD' for the Toronto wall-clock day containing this instant. */
export function torontoDayKey(epochMs: number): string {
  const parts = TORONTO_KEY_FORMATTER.formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The Toronto wall-clock hour (0–23) containing this instant — the live
 * segment's θ lookup: a 5-minute live bucket is judged against the hour it
 * ends in, exactly like the fold does. */
const TORONTO_HOUR_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  hour: 'numeric',
  hour12: false,
});

export function torontoWallHour(epochMs: number): number {
  const hour = Number(TORONTO_HOUR_FORMATTER.format(new Date(epochMs)));
  return ((hour % 24) + 24) % 24;
}

/** The epoch-ms instant Toronto's wall clock hit 00:00 on this day. Converges
 * with hourly steps so DST folds (23 h / 25 h days) land on the true boundary;
 * the 02:00 shift never touches midnight, so the loop is short. */
export function torontoDayStartMs(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  let guess = Date.UTC(year, month - 1, day, 5, 0, 0); // noon-ish UTC, safely inside
  while (torontoDayKey(guess) !== dayKey) {
    guess += torontoDayKey(guess) < dayKey ? 3_600_000 : -3_600_000;
  }
  // guess is inside the day; step back to its exact start.
  let start = guess;
  for (let step = 3_600_000; step >= 1; step = Math.floor(step / 2)) {
    while (torontoDayKey(start - step) === dayKey) start -= step;
  }
  return start;
}

/** The Monday (Toronto convention) of the week containing this day, as a
 * day key. Weeks are how the /sla page rolls days up into wider boxes. */
export function torontoWeekKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
  const backToMonday = (weekday + 6) % 7;
  const monday = Date.UTC(year, month - 1, day - backToMonday);
  const date = new Date(monday);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
