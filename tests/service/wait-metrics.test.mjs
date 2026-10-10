import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const {
  headwaysForStop,
  renewalWaitSeconds,
  cvSquared,
  moments,
  shrinkTowardBaseline,
  baselineExpectedWaitSeconds,
  residualWaitSeconds,
  backToBackCount,
  windowBaseline,
  median,
  gammaCdf,
  gammaQuantile,
} = await compileModules(
  `export * from './shared/service/wait-metrics'; export * from './shared/service/fixtures';`,
);

const T0 = 1_800_000_000_000;
const touch = (stopId, offsetSeconds, vehicleId = '4400') => ({
  t: T0 + offsetSeconds * 1000,
  stopId,
  directionId: 0,
  mode: 'streetcar',
  vehicleId,
  routeId: '506',
});
const interval = (kind, from, to, mode = 'streetcar') => ({
  from: T0 + from * 1000,
  to: T0 + to * 1000,
  mode,
  kind,
});

test('E2S1: headways extract per directional stop with edge and ongoing-gap censoring', () => {
  const windowStart = T0 - 1800000;
  const at = T0;
  // Clockwork: a touch exactly at the window edge and exactly at `at`.
  const clockwork = headwaysForStop(
    [touch('s', -1800), touch('s', -1200), touch('s', -600), touch('s', 0)],
    [interval('observable', -1800, 0)],
    windowStart,
    at,
  );
  assert.deepEqual(clockwork.headways, [600, 600, 600]);
  assert.equal(clockwork.censoredCount, 0);
  assert.equal(clockwork.touchCount, 4);
  // First touch after the window opened → left-censored edge gap; open gap at
  // `at` → right-censored. Both count, neither enters the moments.
  const edges = headwaysForStop(
    [touch('s', -1500), touch('s', -900), touch('s', -300)],
    [interval('observable', -1800, 0)],
    windowStart,
    at,
  );
  assert.deepEqual(edges.headways, [600, 600]);
  assert.equal(edges.censoredCount, 2);
});

test('E2S1: gaps crossing blind spots are censored; coverage counts them instead', () => {
  const windowStart = T0 - 1800000;
  const at = T0;
  const sample = headwaysForStop(
    [touch('s', -1800), touch('s', -1200), touch('s', -600)],
    [
      interval('observable', -1800, -1050),
      interval('outage', -1050, -750),
      interval('observable', -750, 0),
    ],
    windowStart,
    at,
  );
  // Gap 1 (−1800→−1200) is observable; gap 2 (−1200→−600) crosses the outage.
  assert.deepEqual(sample.headways, [600]);
  assert.equal(sample.censoredCount, 2); // outage-spanning gap + ongoing gap
  assert.equal(sample.coverage.observableSeconds, 1500);
  assert.equal(sample.coverage.unmonitoredSeconds, 300);
  assert.equal(sample.coverage.currentKind, 'observable');
});

test('E2S1: coverage is mode-scoped — a subway outage never censors a streetcar gap', () => {
  const windowStart = T0 - 1800000;
  const sample = headwaysForStop(
    [touch('s', -1800), touch('s', -1200)],
    [interval('outage', -1400, -1300, 'subway')],
    windowStart,
    T0 - 1200000,
  );
  assert.deepEqual(sample.headways, [600]);
  assert.equal(sample.coverage.unmonitoredSeconds, 0);
});

test('E2S1: directionality is a first-class dimension — stops never share headways', () => {
  const windowStart = T0 - 1800000;
  const east = [touch('s_e', -1800), touch('s_e', -600)];
  const west = [touch('s_w', -900)];
  assert.deepEqual(headwaysForStop(east, [], windowStart, T0).headways, [1200]);
  assert.deepEqual(headwaysForStop(west, [], windowStart, T0).headways, []);
});

test('E2S2: the §3.2 waiting-time table reproduces exactly — the pitch is a unit test', () => {
  // Even: Σh² = 4×360000 = 1440000, 2Σh = 4800 → 300 s = 5.0 min.
  assert.equal(renewalWaitSeconds([600, 600, 600, 600]), 300);
  // Bunched: Σh² = 2606400 → 543 s = 9.05 min. Same average headway, +81%.
  assert.equal(renewalWaitSeconds([60, 1140, 60, 1140]), 543);
  // CV²: the bunching tax. 0 for even; exactly 0.81 for 1/19 bunching.
  assert.equal(cvSquared(moments([600, 600, 600, 600])), 0);
  assert.equal(cvSquared(moments([60, 1140, 60, 1140])), 0.81);
  // Clockwork yields E[W] = H̄/2 exactly.
  assert.equal(renewalWaitSeconds([600, 600, 600]), 300);
});

test('E2S2: small-sample shrinkage blends toward the baseline with weight n/(n+prior)', () => {
  // n=2, prior=4 → weight 1/3: (100 + 2×50)/3 = 66.6̄
  assert.ok(Math.abs(shrinkTowardBaseline(100, 2, 50, 4) - 200 / 3) < 1e-9);
  // No baseline or zero prior → the estimate stands alone.
  assert.equal(shrinkTowardBaseline(100, 2, null, 4), 100);
  assert.equal(shrinkTowardBaseline(100, 2, 50, 0), 100);
  // The baseline's own E[W] via §3.2: (H̄/2)(1+CV²).
  assert.equal(baselineExpectedWaitSeconds({ meanSeconds: 600, cv2: 0 }), 300);
  const bunchedTarget = baselineExpectedWaitSeconds({ meanSeconds: 390, cv2: 288 / 169 });
  assert.ok(Math.abs(bunchedTarget - (390 / 2) * (1 + 288 / 169)) < 1e-9);
});

test('E2S3: even service counts down — R(e) is the deterministic remainder', () => {
  // Empirical when enough samples exceed e.
  assert.equal(residualWaitSeconds([600, 600, 600], 120, 3), 480);
  assert.equal(residualWaitSeconds([600, 600, 600], 480, 3), 120);
  assert.equal(residualWaitSeconds([600, 600, 600], 540, 3), 60);
  assert.equal(residualWaitSeconds([600, 600, 600], 0, 3), 600);
  // Thin or degenerate samples: the next car comes exactly on schedule.
  assert.equal(residualWaitSeconds([600, 600], 600, 3), 0);
  assert.equal(residualWaitSeconds([240, 240], 1320, 3), 0);
  assert.equal(residualWaitSeconds([1260], 240, 3), 1020);
  assert.equal(residualWaitSeconds([600, 600, 600], 600, 3), 0);
});

test('E2S3: the inversion — waiting past the bunch gap makes R(e) jump UP', () => {
  // Three bunch cycles: headways [30, 1110, 30, 1110, 30, 1110].
  const headways = [30, 1110, 30, 1110, 30, 1110];
  // e = 29: all six gaps exceed → ((1)×3 + (1081)×3)/6 = 541.
  assert.equal(residualWaitSeconds(headways, 29, 3), 541);
  // e = 31: only the three long gaps remain → 1079. Waiting one more second
  // near the bunch boundary more than doubles the expected remaining wait —
  // "the longer you've waited, the longer you'll still wait."
  assert.equal(residualWaitSeconds(headways, 31, 3), 1079);
  // Gamma-smoothed thin samples still produce an honest positive estimate.
  const thin = residualWaitSeconds([30, 1110, 30], 630, 3);
  assert.ok(
    thin !== null && thin > 0,
    `expected a positive smoothed estimate, got ${thin}`,
  );
});

test('E2S3: gamma machinery agrees with closed forms for the exponential case', () => {
  // Exponential = Gamma(k=1, θ=1): CDF(x) = 1 − e⁻ˣ; median = ln 2.
  assert.ok(Math.abs(gammaCdf(1, 1) - (1 - Math.exp(-1))) < 1e-12);
  assert.ok(Math.abs(gammaQuantile(0.5, 1) - Math.LN2) < 1e-6);
  assert.ok(Math.abs(gammaCdf(2, 1) - (1 - Math.exp(-2))) < 1e-12);
});

test('E2S5: back-to-back counts sub-threshold consecutive touches, never more', () => {
  const t = (seconds) => T0 + seconds * 1000;
  // The corpus bunch: two 30 s pairs → 2.
  assert.equal(backToBackCount([t(-1800), t(-1770), t(-660), t(-630)], 45), 2);
  // Clockwork → none.
  assert.equal(backToBackCount([t(-1800), t(-1200), t(-600), t(0)], 45), 0);
  // Same-sample dual touches (Δ = 0) count.
  assert.equal(backToBackCount([t(0), t(0)], 45), 1);
  // The threshold is strict: exactly 45 s is not back-to-back.
  assert.equal(backToBackCount([t(0), t(45)], 45), 0);
  assert.equal(backToBackCount([t(0), t(44.9)], 45), 1);
});

test('E2S6: baselines are deterministic and tier-tested at the touch boundary', () => {
  const windowStart = T0 - 1800000;
  const make = (offsets) =>
    headwaysForStop(
      offsets.map((offset) => touch('s', offset)),
      [interval('observable', -1800, 0)],
      windowStart,
      T0,
    );
  // Three touches (two complete headways) → window tier.
  const rich = windowBaseline(make([-1200, -600, 0]), 3);
  assert.equal(rich.tier, 'window');
  assert.equal(rich.medianSeconds, 600);
  assert.equal(rich.touches, 3);
  assert.equal(rich.cv2, 0);
  // Two touches → collecting, no matter how regular.
  assert.equal(windowBaseline(make([-600, 0]), 3), null);
  // Three touches but every gap censored → no honest baseline.
  const blind = headwaysForStop(
    [touch('s', -1200), touch('s', -600), touch('s', 0)],
    [interval('outage', -1199, -1)],
    windowStart,
    T0,
  );
  assert.equal(windowBaseline(blind, 3), null);
  // Median rules: middle value for odd, average of middles for even.
  assert.equal(median([30, 1110, 30]), 30);
  assert.equal(median([30, 660]), 345);
  assert.equal(median([600]), 600);
  assert.equal(median([]), null);
});
