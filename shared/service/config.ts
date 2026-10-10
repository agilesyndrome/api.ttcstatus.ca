/** Validated SLA service configuration (sla-epics.md §0A; sla.md §4.4, §4.5).
 * Mirrors shared/live/config.ts: defaults live here, overrides come from Wrangler
 * vars, and values that are missing, unparseable, or out of range fall back to
 * the safe default — never clamped into validity (the liveUpdateSeconds pattern).
 * Every downstream consumer reads config; no hard-coded folklore. Initial values
 * are provisional, recorded in sla.md §9, tuned from real data. */

export const DEFAULT_SERVICE_SAMPLE_SECONDS = 30;
export const MIN_SERVICE_SAMPLE_SECONDS = 5;
export const MAX_SERVICE_SAMPLE_SECONDS = 60;

/** The rolling window the raw touch events live in. Design invariant: 5 divides
 * 30, so every 5 minutes exactly one bucket has fully aged out (sla.md §4.5).
 * Not env-configurable — changing it is a product decision, not an ops knob. */
export const SERVICE_WINDOW_SECONDS = 1800;

/** The 5-minute rollup grain. Also a design invariant (see above). */
export const SERVICE_BUCKET_SECONDS = 300;

function validatedInt(
  value: number | string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return parsed >= min && parsed <= max ? Math.round(parsed) : fallback;
}

function validatedNumber(
  value: number | string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return parsed >= min && parsed <= max ? parsed : fallback;
}

/** Sampling cadence of the recorder loop, seconds (default 30). */
export function serviceSampleSeconds(value?: string | number | null): number {
  return validatedInt(
    value,
    DEFAULT_SERVICE_SAMPLE_SECONDS,
    MIN_SERVICE_SAMPLE_SECONDS,
    MAX_SERVICE_SAMPLE_SECONDS,
  );
}

/** How far an alarm may fire late before tick telemetry complains, seconds.
 * Validated by the Stage 0 alarm spike (E0S5); jitter inside this tolerance is
 * made harmless by tickId idempotency. */
export function serviceTickToleranceSeconds(value?: string | number | null): number {
  return validatedInt(value, 10, 1, 60);
}

/** A streetcar fix within this many metres of a directional stop is a touch. */
export function serviceTouchRadiusMetres(value?: string | number | null): number {
  return validatedNumber(value, 40, 10, 200);
}

/** The same (vehicle, stop) re-observed within this window is one service, not
 * five — dwell dedupe (sla.md §4.4). */
export function serviceDwellDedupeSeconds(value?: string | number | null): number {
  return validatedInt(value, 120, 15, 600);
}

/** Consecutive touches under this count as serviced back-to-back (sla.md §3.5). */
export function serviceBackToBackSeconds(value?: string | number | null): number {
  return validatedInt(value, 45, 10, 120);
}

/** Self-relative dryness below this is `fresh`. */
export function serviceFreshDrynessRatio(value?: string | number | null): number {
  return validatedNumber(value, 0.5, 0.1, 1);
}

/** Self-relative dryness at/above this is `void` — "unusual for here"
 * (sla.md §3.4). */
export function serviceVoidDrynessRatio(value?: string | number | null): number {
  return validatedNumber(value, 2, 1, 5);
}

/** Absolute-minutes backstop: egregious even after self-normalization — "yes,
 * and it was 19 minutes". A route that is a disaster all day must not
 * normalize its own pain away. */
export function serviceVoidAbsoluteMinutes(value?: string | number | null): number {
  return validatedInt(value, 15, 5, 60);
}

/** Rollup retention, hours. 36 (not 24) means a full day of history survives an
 * overnight breakage of our own making (sla.md §4.5). */
export function serviceHistoryHours(value?: string | number | null): number {
  return validatedInt(value, 36, 24, 168);
}

/** Uncensored touches before a stop stops being `collecting` (sla.md §4.6). */
export function serviceBaselineMinTouches(value?: string | number | null): number {
  return validatedInt(value, 3, 2, 10);
}

/** Minimum empirical samples above `e` before R(e) trusts the empirical
 * estimator instead of the gamma smoothing (sla.md §3.3). */
export function serviceResidualMinSamples(value?: string | number | null): number {
  return validatedInt(value, 3, 2, 10);
}

/** Small-sample shrinkage prior for E[W]: the window estimate blends toward the
 * delivered baseline with weight n / (n + prior) (sla.md story 2.2). */
export function serviceWaitShrinkPrior(value?: string | number | null): number {
  return validatedInt(value, 4, 0, 50);
}

export type ServiceRecorderMode = 'always' | 'demand-warm';

/** `always` (default) — the entire point is measuring delivery nobody is
 * watching. `demand-warm` arms on first viewer and stays warm N minutes.
 * Decided in Stage 0 (sla-epics.md §0A); recorded in sla.md §9. */
export function serviceRecorderMode(value?: string | number | null): ServiceRecorderMode {
  return value === 'demand-warm' ? 'demand-warm' : 'always';
}

export interface ServiceConfig {
  sampleSeconds: number;
  tickToleranceSeconds: number;
  touchRadiusMetres: number;
  dwellDedupeSeconds: number;
  backToBackSeconds: number;
  freshDrynessRatio: number;
  voidDrynessRatio: number;
  voidAbsoluteMinutes: number;
  historyHours: number;
  baselineMinTouches: number;
  residualMinSamples: number;
  waitShrinkPrior: number;
  recorderMode: ServiceRecorderMode;
}

/** The whole config in one validated object, from any env-shaped object
 * (the Wrangler `Env`, or a plain fixture object in tests). Unknown keys are
 * ignored; every missing or invalid value falls back to its default. */
export function serviceConfig(env?: object | null): ServiceConfig {
  const source = (env ?? {}) as Record<string, string | number | null | undefined>;
  return {
    sampleSeconds: serviceSampleSeconds(source.SERVICE_SAMPLE_SECONDS),
    tickToleranceSeconds: serviceTickToleranceSeconds(
      source.SERVICE_TICK_TOLERANCE_SECONDS,
    ),
    touchRadiusMetres: serviceTouchRadiusMetres(source.SERVICE_TOUCH_RADIUS_METRES),
    dwellDedupeSeconds: serviceDwellDedupeSeconds(source.SERVICE_DWELL_DEDUPE_SECONDS),
    backToBackSeconds: serviceBackToBackSeconds(source.SERVICE_BACK_TO_BACK_SECONDS),
    freshDrynessRatio: serviceFreshDrynessRatio(source.SERVICE_FRESH_DRYNESS_RATIO),
    voidDrynessRatio: serviceVoidDrynessRatio(source.SERVICE_VOID_DRYNESS_RATIO),
    voidAbsoluteMinutes: serviceVoidAbsoluteMinutes(source.SERVICE_VOID_ABSOLUTE_MINUTES),
    historyHours: serviceHistoryHours(source.SERVICE_HISTORY_HOURS),
    baselineMinTouches: serviceBaselineMinTouches(source.SERVICE_BASELINE_MIN_TOUCHES),
    residualMinSamples: serviceResidualMinSamples(source.SERVICE_RESIDUAL_MIN_SAMPLES),
    waitShrinkPrior: serviceWaitShrinkPrior(source.SERVICE_WAIT_SHRINK_PRIOR),
    recorderMode: serviceRecorderMode(source.SERVICE_RECORDER_MODE),
  };
}
