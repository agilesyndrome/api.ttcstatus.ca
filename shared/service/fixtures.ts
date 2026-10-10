/** Ground-truth scenario corpus (sla.md story 2.8; sla-epics.md §0D).
 * Deterministic fixtures with hand-derived expectations — the reference
 * interpretation every later layer must agree with: math tests (E2S8), API
 * contract tests (E3S3), the preview adapter (E0S7), overlay development, and
 * browser tests (E6S3). Nothing in the test stack ever needs the live feed.
 *
 * Honesty rules for this file:
 *  - Every expected number below was derived by hand, in the comment next to
 *    it, from the formulas in sla.md §3. Expected values may never be produced
 *    by the code under test.
 *  - Where a value flows through the gamma smoothing (thin samples) it cannot
 *    be hand-derived exactly; those are marked `approx` and are asserted for
 *    existence/behaviour, not exact value.
 *  - Scenarios are timestamp-independent (fixed T0) and fully deterministic.
 *
 * Semantics fixed here (and recorded in docs/sla-chatter.md):
 *  - Window = [at − 1800 s, at]. A gap is CENSORED (excluded from moments,
 *    counted in coverage) when it is the first-in-window edge gap, when it
 *    overlaps an outage/no-reports interval, or when it is the still-open
 *    ongoing gap (sla.md §3.6).
 *  - Baseline tier: a stop needs ≥ 3 touches (sla.md §4.6) — i.e. ≥ 2
 *    complete headways — else it is `collecting`.
 *  - medianHeadwayOwn = empirical median of uncensored window headways
 *    (Stage 1). Even-length samples average the two middle values.
 *  - expectedWait = R(e) for the rider's current elapsed e (sla.md §3.3, story
 *    3.1 "expectedWait R(e)"); E[W] (§3.2) is the internal shrinkage target.
 *    When sample variance is ~0 the gamma path degenerates to the
 *    deterministic R(e) = max(H̄ − e, 0) — "waiting doesn't help you" (§3.3).
 *  - States: collecting when the baseline is missing; unmonitored when the
 *    evaluation instant falls in an outage/no-reports interval for the stop's
 *    mode (unmonitored beats everything — one fabricated void destroys the
 *    credibility of every real one); otherwise fresh (r < 0.5) / due / void
 *    (r ≥ 2 or e ≥ 15 min absolute). Thresholds from shared/service/config.
 */

import type { CoverageInterval, ServiceStateKind, TouchEvent } from './contracts';

/** A fixed, arbitrary epoch anchor. All scenario times are T0 + offset ms. */
export const T0 = 1_800_000_000_000;

const ms = (seconds: number) => seconds * 1000;
const at = (offsetSeconds: number) => T0 + ms(offsetSeconds);

export interface ResidualWaitSample {
  /** Elapsed wait, seconds. */
  e: number;
  /** Expected R(e), seconds — hand-derived. */
  expect: number;
}

export interface ExpectedStopDetails {
  touchCount: number;
  /** Uncensored headways, seconds, in order. */
  headways: number[];
  /** Gaps excluded from moments (edge, outage-overlap, ongoing). */
  censoredHeadwayCount: number;
  /** Observable seconds inside the window. */
  coverageObservableSeconds: number;
  /** Outage + no-reports seconds inside the window. */
  unmonitoredSeconds: number;
  minutesSince: number | null;
  medianHeadwayOwnSeconds: number | null;
  /** CV² — null when fewer than two uncensored headways. */
  irregularity: number | null;
  dryness: number | null;
  state: ServiceStateKind;
  backToBack: number;
  /** R(e) at the scenario's elapsed e; null when no honest estimate exists. */
  expectedWaitSeconds: number | null;
  /** True when the value flows through gamma smoothing (asserted loosely). */
  expectedWaitApprox?: boolean;
  /** Extra hand-derived R(e) samples at other elapsed values. */
  residualWaitSamples?: ResidualWaitSample[];
}

export interface ServiceScenario {
  id: string;
  description: string;
  /** Evaluation instant (epoch ms). */
  at: number;
  windowStart: number;
  touches: TouchEvent[];
  coverage: CoverageInterval[];
  /** Only watched stops are asserted; keyed by stopId. */
  expectations: Record<string, ExpectedStopDetails>;
  /** Geographic positions for the fixture stops — the preview adapter and the
   * debug overlay's dev fallback positioning (live data joins on the map's own
   * stop features instead). Purely dev-facing. */
  stopPositions: Record<string, { latitude: number; longitude: number }>;
}

/** sla.md §3.2's waiting-time table, verbatim — the pitch, the business case,
 * and a unit test. Headways in seconds: 10 min clockwork vs the 1/19 bunch.
 * E[W] = Σh² / 2Σh;  CV² = Var(H)/E[H]². */
export const WORKED_EXAMPLE = {
  even: {
    headwaySeconds: [600, 600, 600, 600],
    // Σh = 2400, Σh² = 4 × 360000 = 1440000 → E[W] = 1440000/4800 = 300 s = 5.0 min.
    expectedWaitSeconds: 300,
    // Var = 0 → CV² = 0. Evenness makes the bunching tax zero.
    cv2: 0,
  },
  bunched: {
    headwaySeconds: [60, 1140, 60, 1140],
    // Σh = 2400, Σh² = 2×3600 + 2×1299600 = 2606400 → E[W] = 2606400/4800 = 543 s
    // = 9.05 min. Same streetcars per hour, same average headway: +81%.
    expectedWaitSeconds: 543,
    // H̄ = 600, E[h²] = 651600, Var = 651600 − 360000 = 291600 → CV² = 291600/360000
    // = 0.81 exactly.
    cv2: 0.81,
  },
} as const;

/** The corridor's ordered stops for the one-way-void scenario (pattern order). */
export const VOID_CORRIDOR_STOPS = ['st_void_1', 'st_void_2', 'st_void_3', 'st_void_4'];

const streetcarTouch = (
  stopId: string,
  offsetSeconds: number,
  vehicleId: string,
  routeId = '506',
  directionId: 0 | 1 = 0,
): TouchEvent => ({
  t: at(offsetSeconds),
  stopId,
  directionId,
  mode: 'streetcar',
  vehicleId,
  routeId,
});

const observable = (
  mode: 'streetcar' | 'subway',
  from: number,
  to: number,
): CoverageInterval => ({
  from: at(from),
  to: at(to),
  mode,
  kind: 'observable',
});

const clockworkExpectation = (): ExpectedStopDetails => ({
  touchCount: 4,
  headways: [600, 600, 600],
  censoredHeadwayCount: 0,
  coverageObservableSeconds: 1800,
  unmonitoredSeconds: 0,
  minutesSince: 0,
  medianHeadwayOwnSeconds: 600,
  irregularity: 0,
  dryness: 0,
  state: 'fresh',
  backToBack: 0,
  // R(0): all three headways exceed 0 → empirical Σh/#{h>0} = 1800/3 = 600.
  expectedWaitSeconds: 600,
  // Even service counts down: R(e) = 600 − e for e < 600, then 0 (§3.3).
  residualWaitSamples: [
    { e: 120, expect: 480 },
    { e: 480, expect: 120 },
    { e: 540, expect: 60 },
  ],
});

export const SCENARIOS: ServiceScenario[] = [
  {
    id: 'clockwork',
    stopPositions: {
      st_clock: {
        latitude: 43.653,
        longitude: -79.3988,
      },
    },
    description:
      'Clockwork service: one car every 10 minutes for the whole window. Even service means E[W] = H̄/2 and R(e) counts down to zero.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      streetcarTouch('st_clock', -1800, '4400'),
      streetcarTouch('st_clock', -1200, '4400'),
      streetcarTouch('st_clock', -600, '4400'),
      streetcarTouch('st_clock', 0, '4400'),
    ],
    coverage: [observable('streetcar', -1800, 0)],
    expectations: { st_clock: clockworkExpectation() },
  },
  {
    id: 'waiting-paradox',
    stopPositions: {
      st_even: {
        latitude: 43.653,
        longitude: -79.3988,
      },
      st_bunched: {
        latitude: 43.653,
        longitude: -79.3976,
      },
    },
    description:
      'The §3.2 table made real: an evenly-spaced stop and a bunched stop in the same window. Same average headway; wildly different rider experience.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      // Even side: 10-minute headways.
      streetcarTouch('st_even', -1800, '4401'),
      streetcarTouch('st_even', -1200, '4401'),
      streetcarTouch('st_even', -600, '4401'),
      streetcarTouch('st_even', 0, '4401'),
      // Bunched side: two pairs (back-to-back cars), ~19 minutes apart.
      streetcarTouch('st_bunched', -1800, '4402'),
      streetcarTouch('st_bunched', -1770, '4403'),
      streetcarTouch('st_bunched', -660, '4402'),
      streetcarTouch('st_bunched', -630, '4403'),
    ],
    coverage: [observable('streetcar', -1800, 0)],
    expectations: {
      st_even: clockworkExpectation(),
      st_bunched: {
        touchCount: 4,
        // Gaps: 30 (within pair 1), 1110 (pair 1 → pair 2), 30 (within pair 2).
        headways: [30, 1110, 30],
        // The gap still open at `at` (−630 → 0) is right-censored.
        censoredHeadwayCount: 1,
        coverageObservableSeconds: 1800,
        unmonitoredSeconds: 0,
        // e = 630 s = 10.5 min since the pair passed.
        minutesSince: 10.5,
        // Median of [30, 1110, 30] = 30 s.
        medianHeadwayOwnSeconds: 30,
        // H̄ = 390; E[h²] = (900 + 1232100 + 900)/3 = 411300; Var = 411300 − 152100
        // = 259200; CV² = 259200/152100 = 288/169 ≈ 1.704142.
        irregularity: 288 / 169,
        // r = 630/30 = 21 — the void the pair manufactured behind itself.
        dryness: 21,
        state: 'void',
        // Two same-stop pairs under 45 s: one at each pass.
        backToBack: 2,
        // #{h > 630} = 1 < 3 → gamma smoothing (approx; existence-asserted).
        expectedWaitSeconds: null,
        expectedWaitApprox: true,
      },
    },
  },
  {
    id: 'one-way-void',
    stopPositions: {
      st_void_1: {
        latitude: 43.653,
        longitude: -79.3988,
      },
      st_void_2: {
        latitude: 43.653,
        longitude: -79.3976,
      },
      st_void_3: {
        latitude: 43.653,
        longitude: -79.3964,
      },
      st_void_4: {
        latitude: 43.653,
        longitude: -79.3952,
      },
      st_void_1_w: {
        latitude: 43.65325,
        longitude: -79.399,
      },
    },
    description:
      'A bunched pair travelling a corridor drags a one-directional void behind it (the wave of void, §3.9); the opposite direction runs beautifully.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      // Direction 0: regular car, then a bunched pair, then silence — a void.
      ...VOID_CORRIDOR_STOPS.flatMap((stopId) => [
        streetcarTouch(stopId, -1800, '4404'),
        streetcarTouch(stopId, -1140, '4405'),
        streetcarTouch(stopId, -1110, '4406'),
      ]),
      // Direction 1 twin stop: clockwork, untouched by the mess next door.
      streetcarTouch('st_void_1_w', -1800, '4407', '506', 1),
      streetcarTouch('st_void_1_w', -900, '4407', '506', 1),
      streetcarTouch('st_void_1_w', 0, '4407', '506', 1),
    ],
    coverage: [observable('streetcar', -1800, 0)],
    expectations: {
      ...Object.fromEntries(
        VOID_CORRIDOR_STOPS.map((stopId) => [
          stopId,
          {
            touchCount: 3,
            // Gaps: 1800→1140 = 660 s, then the 30 s pair.
            headways: [660, 30],
            // Ongoing gap −1110 → 0 (still open at `at`).
            censoredHeadwayCount: 1,
            coverageObservableSeconds: 1800,
            unmonitoredSeconds: 0,
            // e = 1110 s = 18.5 min since the pair passed this stop.
            minutesSince: 18.5,
            // Median of [30, 660] = 345 s.
            medianHeadwayOwnSeconds: 345,
            // H̄ = 345; E[h²] = (435600 + 900)/2 = 218250; Var = 218250 − 119025
            // = 99225; CV² = 99225/119025 = 441/529 = (21/23)² ≈ 0.833648.
            irregularity: 441 / 529,
            // r = 1110/345 ≈ 3.217 — void on the self-relative axis…
            dryness: 1110 / 345,
            state: 'void',
            // …and 18.5 min ≥ 15 min — void on the absolute axis too. Both truths.
            backToBack: 1,
            // #{h > 1110} = 0 → gamma (approx; existence-asserted).
            expectedWaitSeconds: null,
            expectedWaitApprox: true,
          } satisfies ExpectedStopDetails,
        ]),
      ),
      st_void_1_w: {
        touchCount: 3,
        headways: [900, 900],
        // Last touch lands exactly at `at` — no open gap.
        censoredHeadwayCount: 0,
        coverageObservableSeconds: 1800,
        unmonitoredSeconds: 0,
        minutesSince: 0,
        medianHeadwayOwnSeconds: 900,
        irregularity: 0,
        dryness: 0,
        state: 'fresh',
        backToBack: 0,
        // R(0) with Var = 0 → deterministic H̄ = 900.
        expectedWaitSeconds: 900,
      },
    },
  },
  {
    id: 'terminal-dwell',
    stopPositions: {
      st_terminal: {
        latitude: 43.653,
        longitude: -79.3952,
      },
    },
    description:
      'A car laying over at a terminal is ONE service, not five (dwell dedupe upstream). Two touches is too thin for a baseline: collecting, honestly.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      streetcarTouch('st_terminal', -1500, '4408'),
      // The recorder-side fixture (E1S4) proves seven 30 s fixes at the terminal
      // collapse into exactly this one touch.
      streetcarTouch('st_terminal', -240, '4409'),
    ],
    coverage: [observable('streetcar', -1800, 0)],
    expectations: {
      st_terminal: {
        touchCount: 2,
        // The one complete gap: −1500 → −240.
        headways: [1260],
        // Censored: the window-edge gap (first touch at −1500, after the
        // window opened at −1800) and the open gap −240 → 0.
        censoredHeadwayCount: 2,
        coverageObservableSeconds: 1800,
        unmonitoredSeconds: 0,
        // e = 240 s = 4 min.
        minutesSince: 4,
        // Two touches < 3 → collecting; no baseline, so no median, no dryness.
        medianHeadwayOwnSeconds: null,
        irregularity: null,
        dryness: null,
        state: 'collecting',
        backToBack: 0,
        // R(240) with a single headway: Var undefined → deterministic
        // max(1260 − 240, 0) = 1020.
        expectedWaitSeconds: 1020,
      },
    },
  },
  {
    id: 'night-and-day',
    stopPositions: {
      st_night: {
        latitude: 43.6525,
        longitude: -79.3988,
      },
      st_disaster: {
        latitude: 43.6525,
        longitude: -79.3976,
      },
    },
    description:
      'Self-relative baselines calm night service by themselves (§3.4): a stop running every 10 minutes at 2 a.m. shows due at 10 minutes — while a 4-minute day route that has been dark for 22 minutes is void on both axes.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      // Night service: route 306, 10-minute headways (Blue Night stays distinct).
      streetcarTouch('st_night', -1800, '4410', '306'),
      streetcarTouch('st_night', -1200, '4410', '306'),
      streetcarTouch('st_night', -600, '4410', '306'),
      // All-day disaster: route 506 running 4-minute headways… until it didn't.
      streetcarTouch('st_disaster', -1800, '4411'),
      streetcarTouch('st_disaster', -1560, '4411'),
      streetcarTouch('st_disaster', -1320, '4411'),
    ],
    coverage: [observable('streetcar', -1800, 0)],
    expectations: {
      st_night: {
        touchCount: 3,
        headways: [600, 600],
        // Open gap −600 → 0.
        censoredHeadwayCount: 1,
        coverageObservableSeconds: 1800,
        unmonitoredSeconds: 0,
        // e = 600 s = 10 min — as long as they usually make you wait.
        minutesSince: 10,
        medianHeadwayOwnSeconds: 600,
        irregularity: 0,
        // r = 600/600 = 1.0 → due. Calm, at 2 a.m. and everywhere else.
        dryness: 1,
        state: 'due',
        backToBack: 0,
        // Even service: R(600) = max(600 − 600, 0) = 0 — the next car is now.
        expectedWaitSeconds: 0,
      },
      st_disaster: {
        touchCount: 3,
        headways: [240, 240],
        censoredHeadwayCount: 1,
        coverageObservableSeconds: 1800,
        unmonitoredSeconds: 0,
        // e = 1320 s = 22 min.
        minutesSince: 22,
        medianHeadwayOwnSeconds: 240,
        irregularity: 0,
        // r = 1320/240 = 5.5 → void on the ratio axis…
        dryness: 5.5,
        state: 'void',
        // …and 22 min ≥ 15 min on the absolute axis. Normalization never hides
        // "yes, and it was 22 minutes."
        backToBack: 0,
        // Deterministic countdown long past: R(1320) = max(240 − 1320, 0) = 0.
        expectedWaitSeconds: 0,
      },
    },
  },
  {
    id: 'outage',
    stopPositions: {
      st_outage: {
        latitude: 43.652,
        longitude: -79.399,
      },
    },
    description:
      'A feed outage is unmonitored time, never a void (§3.6). The gap spanning the outage is interval-censored: excluded from moments, counted in coverage, and the stop shows due — not void.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      streetcarTouch('st_outage', -1800, '4412'),
      streetcarTouch('st_outage', -1200, '4412'),
      streetcarTouch('st_outage', -600, '4413'),
    ],
    coverage: [
      observable('streetcar', -1800, -1050),
      // A 5-minute outage sits inside the second gap.
      { from: at(-1050), to: at(-750), mode: 'streetcar', kind: 'outage' },
      observable('streetcar', -750, 0),
    ],
    expectations: {
      st_outage: {
        touchCount: 3,
        // Gap 1 (−1800→−1200, 600 s) is complete and observable.
        // Gap 2 (−1200→−600) overlaps the outage → censored.
        headways: [600],
        // Censored: the outage-spanning gap AND the still-open −600 → 0 gap.
        censoredHeadwayCount: 2,
        coverageObservableSeconds: 1500,
        unmonitoredSeconds: 300,
        // e = 600 s = 10 min.
        minutesSince: 10,
        // Baseline from the one uncensored headway: median 600.
        medianHeadwayOwnSeconds: 600,
        // One headway → CV² undefined.
        irregularity: null,
        // r = 600/600 = 1.0 → due. The outage never became a void.
        dryness: 1,
        state: 'due',
        backToBack: 0,
        // Even service: R(600) = max(600 − 600, 0) = 0.
        expectedWaitSeconds: 0,
      },
    },
  },
  {
    id: 'outage-live',
    stopPositions: {
      st_silent: {
        latitude: 43.6495,
        longitude: -79.3976,
      },
    },
    description:
      'A silent Line 5/6 subway feed right now: the stop is unmonitored — hatched and apologetic, never a void. No touches observed means no honest estimate at all.',
    at: at(0),
    windowStart: at(-1800),
    touches: [
      {
        t: at(-1800),
        stopId: 'st_silent',
        directionId: 0,
        mode: 'subway',
        vehicleId: 'train_5101',
        routeId: '5',
      },
    ],
    coverage: [
      observable('subway', -1800, -1500),
      // Silent Line 5/6: feed up, zero reports (sla.md §4.6 rule 2).
      { from: at(-1500), to: at(0), mode: 'subway', kind: 'no-reports' },
    ],
    expectations: {
      st_silent: {
        touchCount: 1,
        // The only gap (−1800 → 0) overlaps the no-reports interval and is
        // still open: censored.
        headways: [],
        censoredHeadwayCount: 1,
        coverageObservableSeconds: 300,
        unmonitoredSeconds: 1500,
        minutesSince: 30,
        // No baseline, no moments, no estimate. Honest emptiness.
        medianHeadwayOwnSeconds: null,
        irregularity: null,
        dryness: null,
        state: 'unmonitored',
        backToBack: 0,
        expectedWaitSeconds: null,
      },
    },
  },
];

export function scenarioById(id: string): ServiceScenario {
  const scenario = SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown scenario '${id}'.`);
  return scenario;
}

/** Every watched stop across the corpus — useful for iteration in tests. */
export function scenarioExpectationIds(scenario: ServiceScenario): string[] {
  return Object.keys(scenario.expectations);
}
