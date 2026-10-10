import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

// Epic 8, E8S2: the promise-lens math, tested like the math library it joins —
// every expected value derived by hand in the comments, exactly like
// tests/service/wait-metrics.test.mjs does.
const {
  slaThresholdSeconds,
  slaComplianceParts,
  slaComplianceRatio,
  mergeSlaParts,
  slaBandFor,
  hourlyScheduledHeadways,
  scheduledBands,
  advertisedHeadwaySeconds,
  torontoDayKey,
  torontoDayStartMs,
  torontoWeekKey,
} = await compileModules(
  `export {
    slaThresholdSeconds,
    slaComplianceParts,
    slaComplianceRatio,
    mergeSlaParts,
    slaBandFor,
    hourlyScheduledHeadways,
    scheduledBands,
    advertisedHeadwaySeconds,
    torontoDayKey,
    torontoDayStartMs,
    torontoWeekKey,
  } from './shared/service/sla-metrics';`,
);

test('threshold is the scheduled headway times the tolerance', () => {
  assert.equal(slaThresholdSeconds(600, 1.5), 900);
  assert.equal(slaThresholdSeconds(300, 1), 300);
});

test('clockwork service is exactly 100% within a 1.5x SLA', () => {
  // Four 10-minute gaps: n=4, sum=2400, sumSq=4×600²=1 440 000. Every gap ≤
  // θ=900, so E[min(H,θ)] = 600 per gap — compliant 2400/2400, degenerate
  // path, exact (no approximation).
  const parts = slaComplianceParts({ n: 4, sum: 2400, sumSq: 1_440_000 }, 900);
  assert.deepEqual(parts, { gapSeconds: 2400, compliantSeconds: 2400 });
  assert.equal(slaComplianceRatio(parts), 1);
});

test('clockwork against a tighter SLA than the headway is exactly partial', () => {
  // θ=480 < H̄=600: E[min]=480 per gap → 1920/2400 = 0.8 exactly.
  const parts = slaComplianceParts({ n: 4, sum: 2400, sumSq: 1_440_000 }, 480);
  assert.equal(parts.compliantSeconds, 1920);
  assert.equal(slaComplianceRatio(parts), 0.8);
});

test('the §3.2 bunched pair is time-weighted, not count-weighted', () => {
  // Gaps 1,19,1,19 minutes (the doc's table): sum=2400,
  // sumSq=2×60²+2×1140²=2 606 400 → H̄=600, Var=291 600, CV²=0.81.
  // The count-based answer would be 0.5 (two of four gaps within θ=900);
  // the honest time-weighted answer is 0.8 — the first 15 minutes of a
  // 19-minute gap ARE within the SLA, only the 4-minute tail is not:
  // (15+15+1+1)/40 = 0.8 exactly from raw gaps. The gamma estimate agrees
  // within its labelled tolerance and is deterministic.
  const moments = { n: 4, sum: 2400, sumSq: 2_606_400 };
  const first = slaComplianceParts(moments, 900);
  const again = slaComplianceParts(moments, 900);
  const ratio = slaComplianceRatio(first);
  assert.ok(ratio !== null && Math.abs(ratio - 0.8) < 0.06, `ratio ${ratio}`);
  assert.notEqual(ratio, 0.5); // never the count-based lie
  assert.deepEqual(first, again); // deterministic
  // The tail is what a rider waited beyond the SLA: ~20% of gap time.
  const over = 1 - first.compliantSeconds / first.gapSeconds;
  assert.ok(Math.abs(over - 0.2) < 0.06);
});

test('no data and no promise are honest nulls, never zero', () => {
  assert.equal(slaComplianceParts({ n: 0, sum: 0, sumSq: 0 }, 900), null);
  assert.equal(slaComplianceParts({ n: 4, sum: 2400, sumSq: 1_440_000 }, 0), null);
  assert.equal(slaComplianceRatio({ gapSeconds: 0, compliantSeconds: 0 }), null);
});

test('parts merge exactly — the additive spine of every rollup', () => {
  const a = { gapSeconds: 2400, compliantSeconds: 2400 };
  const b = { gapSeconds: 1600, compliantSeconds: 1200 };
  const merged = mergeSlaParts([a, b]);
  assert.deepEqual(merged, { gapSeconds: 4000, compliantSeconds: 3600 });
  assert.equal(slaComplianceRatio(merged), 0.9);
});

test('banding follows config thresholds, shared by API and UI', () => {
  assert.equal(slaBandFor(null, 0.9, 0.7), 'no-data');
  assert.equal(slaBandFor(0.9, 0.9, 0.7), 'met');
  assert.equal(slaBandFor(0.95, 0.9, 0.7), 'met');
  assert.equal(slaBandFor(0.7, 0.9, 0.7), 'degraded');
  assert.equal(slaBandFor(0.85, 0.9, 0.7), 'degraded');
  assert.equal(slaBandFor(0.69, 0.9, 0.7), 'missed');
  assert.equal(slaBandFor(0, 0.9, 0.7), 'missed');
});

test('hourly scheduled headways: gaps attribute to the hour that started them', () => {
  // Departures 06:00, 06:10, 06:20, 07:15, 07:25 → gaps 600, 600, 3300, 600.
  // The 3300-second gap starts at 06:20, so it is hour 6's promise ("a car
  // came at 6:20; the next is 55 min later") — and the median keeps the
  // band at 600 despite it. Hour 7's own gap is 600. Hours without a
  // departure carry no promise.
  const bands = hourlyScheduledHeadways([21_600, 22_200, 22_800, 26_100, 26_700]);
  assert.equal(bands[6], 600);
  assert.equal(bands[7], 600);
  assert.equal(bands[5], null);
  assert.equal(bands[8], null);
});

test('hourly scheduled headways: overnight trips fold into the next day hour', () => {
  // 23:50 and 25:30 (01:30 next day): the 100-minute gap is the 23:00 band's
  // promise — "a car came at 23:50, the next is scheduled at 01:30". The 01:00
  // band has no departure of its own and carries no promise.
  const bands = hourlyScheduledHeadways([85_800, 91_800]);
  assert.equal(bands[23], 6000);
  assert.equal(bands[1], null);
});

test('hourly scheduled headways use the median, so one tripper cannot move the promise', () => {
  // Departures 08:00, 08:05, 08:10, 08:15, 08:30 → gaps 300, 300, 300, 900
  // (an inserted school tripper). Median 300 — and the advertised floor
  // lifts it to the 10-minute promise the TTC would publish for it.
  const bands = hourlyScheduledHeadways([28_800, 29_100, 29_400, 29_700, 30_600]);
  assert.equal(bands[8], 600);
});

test("targets publish on the TTC's advertised 5-minute grid, floored at 10", () => {
  // The TTC never advertises better than 10 minutes, even where the schedule
  // offers it: 8–12 publishes 10, 13–17 publishes 15, 18–22 publishes 20.
  assert.equal(advertisedHeadwaySeconds(300), 600); // 5 min → 10
  assert.equal(advertisedHeadwaySeconds(480), 600); // 8 min → 10
  assert.equal(advertisedHeadwaySeconds(570), 600); // 9.5 min → 10
  assert.equal(advertisedHeadwaySeconds(660), 600); // 11 min → 10
  assert.equal(advertisedHeadwaySeconds(720), 600); // 12 min → 10
  assert.equal(advertisedHeadwaySeconds(780), 900); // 13 min → 15
  assert.equal(advertisedHeadwaySeconds(900), 900); // 15 min stays 15
  assert.equal(advertisedHeadwaySeconds(1020), 900); // 17 min → 15
  assert.equal(advertisedHeadwaySeconds(1080), 1200); // 18 min → 20
  assert.equal(advertisedHeadwaySeconds(1800), 1800); // 30 min stays 30
});

test('scheduled bands merge adjacent hours into published runs', () => {
  const hourly = Array.from({ length: 24 }, () => null);
  hourly[6] = 600;
  hourly[7] = 600;
  hourly[8] = 900;
  hourly[9] = 900;
  const bands = scheduledBands(hourly);
  assert.deepEqual(bands, [
    { fromHour: 6, toHour: 8, headwaySeconds: 600 },
    { fromHour: 8, toHour: 10, headwaySeconds: 900 },
  ]);
  assert.deepEqual(scheduledBands(Array.from({ length: 24 }, () => null)), []);
  // Equal advertised values must NOT merge across a service gap: the 506's
  // real weekday grid runs 0:00–3:00 and 4:00–24:00 with a dead third hour —
  // two honest bands, never one all-day band claiming 3:00–4:00 service.
  const withGap = Array.from({ length: 24 }, () => null);
  withGap[0] = 600;
  withGap[1] = 600;
  withGap[2] = 600;
  withGap[4] = 600;
  withGap[23] = 600;
  assert.deepEqual(scheduledBands(withGap), [
    { fromHour: 0, toHour: 3, headwaySeconds: 600 },
    { fromHour: 4, toHour: 5, headwaySeconds: 600 },
    { fromHour: 23, toHour: 24, headwaySeconds: 600 },
  ]);
});

test('Toronto day keys: DST-safe boundaries in both directions', () => {
  // Summer: Toronto midnight is 04:00Z.
  assert.equal(torontoDayKey(Date.UTC(2026, 9, 10, 4)), '2026-10-10');
  assert.equal(torontoDayKey(Date.UTC(2026, 9, 10, 3, 59)), '2026-10-09');
  assert.equal(torontoDayStartMs('2026-10-10'), Date.UTC(2026, 9, 10, 4));
  // Winter: 05:00Z.
  assert.equal(torontoDayStartMs('2026-01-15'), Date.UTC(2026, 0, 15, 5));
  // Fall back (2026-11-01): a 25-hour day — start EDT, end EST.
  assert.equal(torontoDayStartMs('2026-11-01'), Date.UTC(2026, 10, 1, 4));
  assert.equal(torontoDayStartMs('2026-11-02'), Date.UTC(2026, 10, 2, 5));
  // Spring forward (2026-03-08): a 23-hour day.
  assert.equal(torontoDayStartMs('2026-03-08'), Date.UTC(2026, 2, 8, 5));
  assert.equal(torontoDayStartMs('2026-03-09'), Date.UTC(2026, 2, 9, 4));
});

test('Toronto week keys are Mondays', () => {
  assert.equal(torontoWeekKey('2026-10-10'), '2026-10-05'); // Saturday
  assert.equal(torontoWeekKey('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(torontoWeekKey('2026-10-04'), '2026-09-28'); // Sunday
  assert.equal(torontoWeekKey('2026-11-01'), '2026-10-26'); // DST Sunday
});
