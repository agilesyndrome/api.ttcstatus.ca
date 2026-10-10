import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

// The live tier's brain (Epic 8's third chart tier): pure, hand-derived.
// Bucket ends sit on the recorder's own 5-minute grid; a stop is "within
// the promise" at a bucket's end when the elapsed since its last touch is
// within the advertised target × tolerance — the same θ the daily fold
// uses. Dry stops are judged from the live states' lastTouchAt (a corridor
// silent for the whole window is red, never excluded); outages are grey;
// unpromised hours are hollow.
const { liveBucketEnds, liveBucketsForRoute, liveBucketsForStop, torontoWallHour } =
  await compileModules(`
  export {
    liveBucketEnds,
    liveBucketsForRoute,
    liveBucketsForStop,
  } from './web/ui/features/sla/sla-live';
  export { torontoWallHour } from './shared/service/sla-metrics';
`);

const TOLERANCE = 1.5;
const MET = 0.9;
const DEGRADED = 0.7;

function waveFor({ windowStart, windowEnd, routes, coverage = [] }) {
  return { windowStart, windowEnd, routes, coverage };
}

function statesFor(entries) {
  return new Map(
    entries.map(([stopId, lastTouchAt, routeIds = ['506']]) => [
      stopId,
      { lastTouchAt, routeIds },
    ]),
  );
}

test("bucket ends sit on the recorder's 5-minute grid", () => {
  const ends = liveBucketEnds(Date.parse('2026-10-10T16:12:00Z'));
  assert.equal(ends.length, 6);
  assert.equal(ends[0], Date.parse('2026-10-10T16:10:00Z'));
  assert.equal(ends[5], Date.parse('2026-10-10T15:45:00Z'));
});

test('clockwork service is all-green across the live window', () => {
  // Two stops, a touch every 10 minutes against a 10-minute target (θ=15):
  // every bucket end sees elapsed ≤ 10 min → every sliver met.
  const windowStart = Date.parse('2026-10-10T16:00:00Z');
  const windowEnd = Date.parse('2026-10-10T16:30:00Z');
  const minutes = (m) => Date.parse(`2026-10-10T16:${String(m).padStart(2, '0')}Z`);
  const wave = waveFor({
    windowStart,
    windowEnd,
    routes: [
      {
        routeId: '506',
        patternStopIds: ['sa', 'sb'],
        touches: [0, 10, 20, 30].flatMap((m) => [
          { stopIndex: 0, dt: minutes(m) - windowStart },
          { stopIndex: 1, dt: minutes(m) - windowStart },
        ]),
      },
    ],
  });
  const bands = Array.from({ length: 24 }, () => 600);
  const buckets = liveBucketsForRoute(
    '506',
    wave,
    statesFor([]),
    bands,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  assert.equal(buckets.length, 6);
  for (const bucket of buckets) {
    assert.equal(bucket.compliance, 1);
    assert.equal(bucket.band, 'met');
    assert.equal(bucket.monitored, true);
  }
});

test('a dry corridor is honestly red, judged from the live states', () => {
  // No touches inside the window at all — but the states remember the last
  // touch 20 minutes before the window: every bucket end is beyond θ=15
  // minutes → missed. The elapsed SHRINKS bucket by bucket as the remembered
  // touch ages out of reach… no: it grows, and the slivers go red.
  const windowStart = Date.parse('2026-10-10T16:00:00Z');
  const windowEnd = Date.parse('2026-10-10T16:30:00Z');
  const wave = waveFor({
    windowStart,
    windowEnd,
    routes: [{ routeId: '506', patternStopIds: ['sa'], touches: [] }],
  });
  const lastTouchAt = Date.parse('2026-10-10T15:40:00Z');
  const bands = Array.from({ length: 24 }, () => 600);
  const buckets = liveBucketsForRoute(
    '506',
    wave,
    statesFor([['sa', lastTouchAt]]),
    bands,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  // The newest bucket ends 16:30 — elapsed 50 min > 15: missed. Every one of
  // the six is missed; the corridor never gets the benefit of the doubt.
  for (const bucket of buckets) {
    assert.equal(bucket.compliance, 0);
    assert.equal(bucket.band, 'missed');
  }
});

test('partial corridors band per fraction, not by count', () => {
  // Three stops serviced within θ at every bucket end; one dry since before
  // the window (elapsed 40+ min). Each bucket: fraction 3/4 = 0.75 →
  // degraded (the degraded band is [0.7, 0.9) — a single dry stop of four
  // is degradation, not a miss).
  const windowStart = Date.parse('2026-10-10T16:00:00Z');
  const windowEnd = Date.parse('2026-10-10T16:30:00Z');
  const minutes = (m) => Date.parse(`2026-10-10T16:${String(m).padStart(2, '0')}Z`);
  const wave = waveFor({
    windowStart,
    windowEnd,
    routes: [
      {
        routeId: '506',
        patternStopIds: ['sa1', 'sa2', 'sa3', 'sb'],
        touches: [0, 10, 20, 30].flatMap((m) => [
          { stopIndex: 0, dt: minutes(m) - windowStart },
          { stopIndex: 1, dt: minutes(m) - windowStart },
          { stopIndex: 2, dt: minutes(m) - windowStart },
        ]),
      },
    ],
  });
  const bands = Array.from({ length: 24 }, () => 600);
  const buckets = liveBucketsForRoute(
    '506',
    wave,
    statesFor([['sb', Date.parse('2026-10-10T15:30:00Z')]]),
    bands,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  for (const bucket of buckets) {
    assert.equal(bucket.compliance, 0.75);
    assert.equal(bucket.band, 'degraded');
  }
});

test('unpromised hours and outages are honest, never red', () => {
  const windowStart = Date.parse('2026-10-10T16:00:00Z');
  const windowEnd = Date.parse('2026-10-10T16:30:00Z');
  const wave = waveFor({
    windowStart,
    windowEnd,
    routes: [
      { routeId: '306', patternStopIds: ['sa'], touches: [{ stopIndex: 0, dt: 0 }] },
    ],
    coverage: [
      // An outage covering one bucket in the middle of the window.
      {
        from: Date.parse('2026-10-10T16:15:00Z'),
        to: Date.parse('2026-10-10T16:21:00Z'),
        kind: 'outage',
      },
    ],
  });
  const bands = Array.from({ length: 24 }, () => null); // no promise anywhere
  const hollow = liveBucketsForRoute(
    '306',
    wave,
    statesFor([]),
    bands,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  for (const bucket of hollow) {
    assert.equal(bucket.compliance, null);
    assert.equal(bucket.band, 'no-data');
  }
  // Now promise the hours and watch the outage bucket turn grey.
  const bands2 = Array.from({ length: 24 }, () => 600);
  const mixed = liveBucketsForRoute(
    '306',
    wave,
    statesFor([['sa', windowStart]]),
    bands2,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  const outageBucket = mixed.find(
    (bucket) => bucket.endAt === Date.parse('2026-10-10T16:20:00Z'),
  );
  assert.equal(outageBucket.monitored, false);
  assert.equal(outageBucket.compliance, null);
  const cleanBucket = mixed.find(
    (bucket) => bucket.endAt === Date.parse('2026-10-10T16:25:00Z'),
  );
  assert.equal(cleanBucket.monitored, true);
});

test("stop-level slivers judge the one stop against its route's target", () => {
  const windowStart = Date.parse('2026-10-10T16:00:00Z');
  const windowEnd = Date.parse('2026-10-10T16:30:00Z');
  const minutes = (m) => Date.parse(`2026-10-10T16:${String(m).padStart(2, '0')}Z`);
  const wave = waveFor({
    windowStart,
    windowEnd,
    routes: [
      {
        routeId: '506',
        patternStopIds: ['sa', 'sb'],
        touches: [0, 10, 20, 30].map((m) => ({
          stopIndex: 0,
          dt: minutes(m) - windowStart,
        })),
      },
    ],
  });
  const bands = Array.from({ length: 24 }, () => 600);
  const serviced = liveBucketsForStop(
    'sa',
    wave,
    statesFor([]),
    bands,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  for (const bucket of serviced) {
    assert.equal(bucket.compliance, 1);
  }
  const silent = liveBucketsForStop(
    'sb',
    wave,
    statesFor([['sb', Date.parse('2026-10-10T15:00:00Z')]]),
    bands,
    TOLERANCE,
    MET,
    DEGRADED,
  );
  for (const bucket of silent) {
    assert.equal(bucket.compliance, 0);
  }
});

test('the wall-hour lookup is Toronto-local', () => {
  // 16:10 UTC on a summer day is 12:10 in Toronto — hour 12.
  assert.equal(torontoWallHour(Date.parse('2026-10-10T16:10:00Z')), 12);
  // 03:10 UTC is 23:10 the previous day in Toronto — hour 23.
  assert.equal(torontoWallHour(Date.parse('2026-10-11T03:10:00Z')), 23);
});
