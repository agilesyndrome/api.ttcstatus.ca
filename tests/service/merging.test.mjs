import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const {
  deriveRollupRow,
  mergeRollupRows,
  mergedMeanSeconds,
  mergedCvSquared,
  gammaApproxQuantileSeconds,
  worstGapSeconds,
  crossBucketGapSeconds,
  foldHash,
  bucketStartFor,
  cvSquared,
  moments,
} = await compileModules(`export * from './shared/service/wait-metrics';`);

const T0 = 1_800_000_000_000; // aligned to 300 s bucket boundaries
const BUCKET = 300; // seconds
const bucket = (offsetSeconds) => T0 + offsetSeconds * 1000;
const touch = (stopId, offsetSeconds, vehicleId = '4400', routeId = '506') => ({
  t: T0 + offsetSeconds * 1000,
  stopId,
  directionId: 0,
  mode: 'streetcar',
  vehicleId,
  routeId,
});
const observable = (from, to) => ({
  from: T0 + from * 1000,
  to: T0 + to * 1000,
  mode: 'streetcar',
  kind: 'observable',
});
const allObservable = () => [observable(-1800, 3600)];

test('E2S7: moments merge exactly — the folded span equals the raw span', () => {
  // Bucket A: touches at +30, +90, +270 (record starts here — no leading gap).
  const rowA = deriveRollupRow(
    's',
    bucket(0),
    BUCKET,
    [touch('s', 30), touch('s', 90), touch('s', 270)],
    allObservable(),
    null,
  );
  // Bucket B: touches at +630, +690, +870, preceded by A's last touch (+270):
  // the leading gap (+270 → +630) belongs to B, so every pair is counted once.
  const rowB = deriveRollupRow(
    's',
    bucket(600),
    BUCKET,
    [touch('s', 630), touch('s', 690), touch('s', 870)],
    allObservable(),
    bucket(270),
  );
  assert.deepEqual(rowA.routeIds, ['506']);
  assert.equal(rowA.n, 2); // [60, 180]
  assert.equal(rowB.n, 3); // [360, 60, 180]
  const merged = mergeRollupRows([rowB, rowA]); // order must not matter
  assert.equal(merged.n, 5);
  assert.equal(merged.sum, 240 + 600);
  assert.equal(merged.sumSq, 36000 + 165600);
  assert.equal(mergedMeanSeconds(merged), 168);
  // Merged CV² equals the value computed from the raw events, exactly.
  const raw = cvSquared(moments([60, 180, 360, 60, 180]));
  assert.equal(mergedCvSquared(merged), raw);
  assert.ok(raw > 0.42 && raw < 0.43);
});

test('E2S7: a bunched day folded into buckets keeps its exact bunching tax', () => {
  // Bunch cycle 20 min: pair at +0/+60, next pair at +1200/+1260. The 1140 s
  // gap crosses a bucket boundary — the leading gap makes it survive folding.
  const rowA = deriveRollupRow(
    's',
    bucket(0),
    BUCKET,
    [touch('s', 0), touch('s', 60)],
    allObservable(),
    null,
  );
  const rowB = deriveRollupRow(
    's',
    bucket(1200),
    BUCKET,
    [touch('s', 1200), touch('s', 1260)],
    allObservable(),
    bucket(60),
  );
  const merged = mergeRollupRows([rowA, rowB]);
  assert.equal(merged.maxGapSeconds, 1140);
  assert.equal(merged.maxCrossGapSeconds, 1140);
  assert.equal(worstGapSeconds(merged), 1140);
  // Raw gaps [60, 1140, 60] → merged CV² equals the raw CV² exactly.
  assert.equal(mergedCvSquared(merged), cvSquared(moments([60, 1140, 60])));
  assert.ok(mergedCvSquared(merged) > 1.4);
});

test('E2S7: a back-to-back pair straddling a bucket boundary still counts', () => {
  // Pair at +280/+300 straddles the boundary at +300; second pair +300/+320.
  const rowA = deriveRollupRow(
    's',
    bucket(0),
    BUCKET,
    [touch('s', 0), touch('s', 280)],
    allObservable(),
    null,
  );
  const rowB = deriveRollupRow(
    's',
    bucket(300),
    BUCKET,
    [touch('s', 300), touch('s', 320)],
    allObservable(),
    bucket(280),
  );
  const merged = mergeRollupRows([rowA, rowB]);
  assert.equal(merged.backToBack, 2); // one straddling pair + one within bucket B
  assert.equal(merged.n, 3); // [280, 20, 20] — the 20 s leading gap folded into B
  assert.equal(mergedCvSquared(merged), cvSquared(moments([280, 20, 20])));
  assert.equal(merged.maxCrossGapSeconds, 20);
});

test('E2S7: cross-bucket reconstruction finds a 25-minute wound across six buckets', () => {
  // Touch at +30 (bucket 0), then silence until +1530 (bucket 5): buckets 1–4
  // have no activity rows at all; the wound is findable two ways.
  const rowA = deriveRollupRow(
    's',
    bucket(0),
    BUCKET,
    [touch('s', 30)],
    allObservable(),
    null,
  );
  const rowF = deriveRollupRow(
    's',
    bucket(1500),
    BUCKET,
    [touch('s', 1530)],
    allObservable(),
    bucket(30),
  );
  assert.equal(crossBucketGapSeconds(rowA, rowF), 1530 - 30);
  const merged = mergeRollupRows([rowA, rowF]);
  assert.equal(merged.maxCrossGapSeconds, 1500); // reconstruction view
  assert.equal(merged.maxGapSeconds, 1500); // the leading gap itself
  assert.equal(worstGapSeconds(merged), 1500); // 25 minutes
  assert.equal(merged.n, 1);
});

test('E2S7: quantiles are gamma approximations — labelled, sane, and degenerate-safe', () => {
  // Even service collapses to the mean for every quantile.
  const even = mergeRollupRows([
    deriveRollupRow(
      's',
      bucket(0),
      BUCKET,
      [touch('s', 0), touch('s', 150)],
      allObservable(),
      null,
    ),
  ]);
  assert.equal(mergedMeanSeconds(even), 150);
  assert.equal(mergedCvSquared(even), 0);
  assert.equal(gammaApproxQuantileSeconds(even, 0.5), 150);
  assert.equal(gammaApproxQuantileSeconds(even, 0.9), 150);
  // The §3.2 bunched distribution, folded: mean 600, CV² exactly 0.81.
  const bunched = mergeRollupRows([
    deriveRollupRow(
      's',
      bucket(1200),
      BUCKET,
      [touch('s', 1200), touch('s', 1260)],
      allObservable(),
      bucket(60),
    ),
  ]);
  assert.equal(mergedMeanSeconds(bunched), 600);
  assert.equal(mergedCvSquared(bunched), 0.81);
  const medianApprox = gammaApproxQuantileSeconds(bunched, 0.5);
  const p90Approx = gammaApproxQuantileSeconds(bunched, 0.9);
  // Right-skewed: median below mean, p90 well above. Approximations —
  // asserted as ranges, never as gospel.
  assert.ok(medianApprox > 0 && medianApprox < 600, `median ${medianApprox}`);
  assert.ok(p90Approx > 600, `p90 ${p90Approx}`);
});

test('E4S1 math: deriveRollupRow is deterministic — refold is byte-identical', () => {
  const touches = [touch('s', 1200), touch('s', 1260), touch('s', 1440)];
  const coverage = allObservable();
  const first = deriveRollupRow('s', bucket(1200), BUCKET, touches, coverage, bucket(60));
  const refold = deriveRollupRow(
    's',
    bucket(1200),
    BUCKET,
    touches,
    coverage,
    bucket(60),
  );
  assert.deepEqual(refold, first);
  assert.equal(refold.foldHash, first.foldHash);
  assert.equal(first.n, 3); // [1140, 60, 180]
  // Any content change trips the hash.
  const changed = deriveRollupRow(
    's',
    bucket(1200),
    BUCKET,
    [touch('s', 1200), touch('s', 1260), touch('s', 1441)],
    coverage,
    bucket(60),
  );
  assert.notEqual(changed.foldHash, first.foldHash);
  const otherVehicle = deriveRollupRow(
    's',
    bucket(1200),
    BUCKET,
    [touch('s', 1200, '4401'), touch('s', 1260), touch('s', 1440)],
    coverage,
    bucket(60),
  );
  assert.notEqual(otherVehicle.foldHash, first.foldHash);
  // A censored leading gap (outage between the previous touch and the bucket)
  // changes the moments and the hash — honesty leaves a fingerprint.
  const blind = [
    { from: T0 + 100 * 1000, to: T0 + 1100 * 1000, mode: 'streetcar', kind: 'outage' },
  ];
  const censored = deriveRollupRow('s', bucket(1200), BUCKET, touches, blind, bucket(60));
  assert.equal(censored.n, 2); // leading gap censored away
  assert.notEqual(censored.foldHash, first.foldHash);
});

test('E4S1 math: buckets carry coverage bits, one per 30 s sub-slot, conservative', () => {
  // Fully observable bucket: all ten bits.
  const full = deriveRollupRow(
    's',
    bucket(0),
    BUCKET,
    [touch('s', 30)],
    allObservable(),
    null,
  );
  assert.equal(full.coverageBits, 0b1111111111);
  // An outage across the first 150 s clears sub-slots 0–4; a slot counts as
  // watched only if it was observable for its whole duration.
  const blind = deriveRollupRow(
    's',
    bucket(0),
    BUCKET,
    [touch('s', 30)],
    [
      { from: T0, to: T0 + 150 * 1000, mode: 'streetcar', kind: 'outage' },
      observable(150, 900),
    ],
    null,
  );
  assert.equal(blind.coverageBits, 0b1111100000);
});

test('E4S1 math: foldHash is stable and content-sensitive', () => {
  assert.equal(foldHash(['a', 1, null]), foldHash(['a', 1, null]));
  assert.notEqual(foldHash(['a', 1]), foldHash(['a', 2]));
  assert.notEqual(foldHash(['a', 1]), foldHash(['b', 1]));
  assert.match(foldHash(['x']), /^[0-9a-f]{16}$/);
});

test('bucketStartFor floors to 300 s buckets', () => {
  assert.equal(bucketStartFor(T0, 300), Math.floor(T0 / 300000) * 300000);
  const base = bucketStartFor(T0, 300);
  assert.equal(bucketStartFor(base + 299000, 300), base);
  assert.equal(bucketStartFor(base + 300000, 300), base + 300000);
});
