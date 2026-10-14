import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `
  export * from './web/ui/features/replay/replay';
  export { fetchHistoricalTick } from './shared/live/polling';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const {
  REPLAY_RETENTION_MS,
  REPLAY_MAX_WINDOW_MS,
  REPLAY_QUICK_RANGES,
  quickRangeKeyOf,
  resolveReplayWindow,
  tickStartMs,
  torontoDayBounds,
  torontoDayString,
  formatFrameClock,
  formatScrubClock,
  lerpAngle,
  glideFleet,
  dwellStops,
  edgeIndexById,
  fetchHistoricalTick,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

const TICK_MS = 30_000;

const edge = {
  id: 'e1',
  a: 'n1',
  b: 'n2',
  routeIds: ['501'],
  sourcePoints: [
    [0, 0],
    [100, 0],
  ],
  points: [
    [0, 0],
    [100, 0],
  ],
  sourceDistances: [0, 100],
  lengthMetres: 100,
};
const car = (id, patch = {}) => ({
  vehicle: { id, label: id, latitude: 43.65, longitude: -79.4, observedAt: null },
  point: [0, 0],
  angle: 0,
  stale: false,
  ...patch,
});
const onEdge = (distance) => ({
  edgeId: 'e1',
  distanceAlongMetres: distance,
  distanceFromTrackMetres: 0,
  direction: 1,
  point: [distance, 0],
  angle: 0,
});

test('quick ranges stop at 24 hours and stay inside retention', () => {
  assert.deepEqual(
    REPLAY_QUICK_RANGES.map((quick) => quick.key),
    ['last30m', 'last2h', 'last6h', 'last24h'],
  );
  for (const quick of REPLAY_QUICK_RANGES)
    assert.ok(
      quick.durationMs <= REPLAY_MAX_WINDOW_MS && quick.durationMs <= REPLAY_RETENTION_MS,
    );
  assert.equal(REPLAY_QUICK_RANGES.at(-1).durationMs, REPLAY_MAX_WINDOW_MS);
  assert.equal(quickRangeKeyOf({ kind: 'relative', durationMs: 30 * 60_000 }), 'last30m');
  assert.equal(quickRangeKeyOf({ kind: 'day', day: '2026-10-14' }), '');
});

test('relative windows quantize outward, clamp to retention and never exceed a day', () => {
  const now = 1_800_000_000_000; // 2027-01-14, after any recorded day.
  const window = resolveReplayWindow(
    { kind: 'relative', durationMs: 30 * 60_000 },
    now,
    TICK_MS,
  );
  assert.equal(window.startTick, Math.floor((now - 30 * 60_000) / TICK_MS));
  assert.equal(window.endTick, Math.floor(now / TICK_MS));
  assert.equal(tickStartMs(window.endTick, TICK_MS) <= now, true);
  // A range longer than a day clamps to 24 hours — the replay never loads
  // more than that, however it is asked for.
  const over = resolveReplayWindow(
    { kind: 'relative', durationMs: 9 * 24 * 3_600_000 },
    now,
    TICK_MS,
  );
  assert.equal(over.endTick - over.startTick, Math.floor(REPLAY_MAX_WINDOW_MS / TICK_MS));
  assert.ok(
    tickStartMs(over.endTick, TICK_MS) - tickStartMs(over.startTick, TICK_MS) <=
      REPLAY_MAX_WINDOW_MS + TICK_MS,
  );
});

test('a future or empty range resolves to no window', () => {
  const now = Date.parse('2026-10-14T12:00:00.000Z');
  assert.equal(
    resolveReplayWindow({ kind: 'day', day: '2026-10-15' }, now, TICK_MS),
    null,
  );
});

test('Toronto day bounds follow the local calendar, DST included', () => {
  // A standard day: midnight Toronto = 04:00 UTC (EDT).
  const plain = torontoDayBounds('2026-10-14');
  assert.equal(plain.startMs, Date.parse('2026-10-14T04:00:00.000Z'));
  assert.equal(plain.endMs, Date.parse('2026-10-15T04:00:00.000Z'));
  // Spring-forward day is 23 hours; fall-back day is 25 hours.
  assert.equal(
    torontoDayBounds('2026-03-08').endMs - torontoDayBounds('2026-03-08').startMs,
    23 * 3_600_000,
  );
  assert.equal(
    torontoDayBounds('2026-11-01').endMs - torontoDayBounds('2026-11-01').startMs,
    25 * 3_600_000,
  );
  // A winter day: midnight Toronto = 05:00 UTC (EST).
  assert.equal(
    torontoDayBounds('2026-01-15').startMs,
    Date.parse('2026-01-15T05:00:00.000Z'),
  );
});

test('day strings and clocks read Toronto time', () => {
  // 00:30 Toronto on the 14th is 04:30 UTC.
  assert.equal(torontoDayString(Date.parse('2026-10-14T04:30:00.000Z')), '2026-10-14');
  // 23:30 Toronto on the 13th is 03:30 UTC on the 14th.
  assert.equal(torontoDayString(Date.parse('2026-10-14T03:30:00.000Z')), '2026-10-13');
  const frame = Date.parse('2026-10-13T19:42:30.000Z'); // 15:42:30 EDT
  assert.match(formatFrameClock(frame, 'en-CA'), /3:42:30/);
  assert.match(formatFrameClock(frame, 'en-CA'), /EDT/);
  assert.match(formatScrubClock(frame, 'en-CA'), /3:42/);
});

test('bearings glide the short way round', () => {
  assert.equal(lerpAngle(350, 10, 0.5), 0);
  assert.equal(lerpAngle(10, 350, 0.5), 0);
  assert.equal(lerpAngle(90, 90, 0.3), 90);
});

test('the glide interpolates along the shared edge and leaves frames pristine', () => {
  const edges = edgeIndexById([edge]);
  const source = [
    car('4401', { match: onEdge(10), point: [10, 0] }),
    car('4402', { point: [5, 5], match: undefined }),
    car('4403', { match: onEdge(50), point: [50, 0] }), // leaves the feed
  ];
  const dest = [
    car('4401', { match: onEdge(90), point: [90, 0] }),
    car('4402', { point: [25, 5], match: undefined }),
    car('4404', { point: [7, 7], match: undefined }), // joins the feed
  ];
  const halfway = glideFleet(source, dest, 0.5, edges);
  assert.equal(halfway.length, 4);
  const glided = halfway.find((c) => c.vehicle.id === '4401');
  assert.equal(glided.match.edgeId, 'e1');
  assert.equal(glided.match.distanceAlongMetres, 50);
  assert.deepEqual(glided.point, [50, 0]);
  // Off-track cars glide straight.
  assert.deepEqual(halfway.find((c) => c.vehicle.id === '4402').point, [15, 5]);
  // A car that left holds, dimmed.
  const left = halfway.find((c) => c.vehicle.id === '4403');
  assert.equal(left.stale, true);
  assert.deepEqual(left.point, [50, 0]);
  // A car that joined appears from halfway on, and not before.
  assert.ok(halfway.find((c) => c.vehicle.id === '4404'));
  assert.ok(!glideFleet(source, dest, 0.25, edges).find((c) => c.vehicle.id === '4404'));
  // The input frames are untouched.
  assert.equal(source[0].match.distanceAlongMetres, 10);
  assert.equal(dest[0].match.distanceAlongMetres, 90);
});

test('a changed track match glides straight with the match dropped', () => {
  const edges = edgeIndexById([edge]);
  const source = [car('4401', { match: onEdge(10), point: [10, 0] })];
  const dest = [
    car('4401', {
      match: { ...onEdge(90), edgeId: 'e2' },
      point: [110, 0],
      angle: 45,
    }),
  ];
  const glide = glideFleet(source, dest, 0.5, edges);
  assert.equal(glide[0].match, undefined);
  assert.deepEqual(glide[0].point, [60, 0]);
  assert.equal(glide[0].angle, 22.5);
});

test('recorded stops merge stationary ticks and break across gaps', () => {
  const at = (tick, patch = {}) => ({
    timeMs: tick * TICK_MS,
    latitude: 43.65,
    longitude: -79.4,
    ...patch,
  });
  // Speeds present: a two-tick-plus dwell merges; single ticks do not.
  const stops = dwellStops(
    [
      at(0, { speedMetresPerSecond: 4 }),
      at(1, { speedMetresPerSecond: 0 }),
      at(2, { speedMetresPerSecond: 0 }),
      at(3, { speedMetresPerSecond: 0, nextStopName: 'Queen at Shaw' }),
      at(4, { speedMetresPerSecond: 5 }),
      at(5, { speedMetresPerSecond: 0 }), // a lone red light
      at(6, { speedMetresPerSecond: 4 }),
    ],
    TICK_MS,
  );
  assert.equal(stops.length, 1);
  assert.equal(stops[0].startMs, TICK_MS);
  assert.equal(stops[0].endMs, 3 * TICK_MS);
  assert.equal(stops[0].nextStopName, 'Queen at Shaw');

  // Speeds absent: fixes within 20 m are stationary, a jump is not.
  const driftStops = dwellStops(
    [
      at(10, { latitude: 43.65, longitude: -79.4 }),
      at(11, { latitude: 43.65001, longitude: -79.4 }),
      at(12, { latitude: 43.65002, longitude: -79.4 }),
      at(13, { latitude: 43.6515, longitude: -79.4 }),
    ],
    TICK_MS,
  );
  assert.equal(driftStops.length, 1);
  assert.equal(driftStops[0].startMs, 10 * TICK_MS);
  assert.equal(driftStops[0].endMs, 12 * TICK_MS);

  // A frame gap wider than a tick never bridges two dwells: the outage
  // splits one physical stop into two recorded windows.
  const gapped = dwellStops(
    [
      at(20, { speedMetresPerSecond: 0 }),
      at(21, { speedMetresPerSecond: 0 }),
      at(25, { speedMetresPerSecond: 0, latitude: 43.65003 }),
      at(26, { speedMetresPerSecond: 0, latitude: 43.65003 }),
    ],
    TICK_MS,
  );
  assert.equal(gapped.length, 2);
  assert.equal(gapped[0].endMs, 21 * TICK_MS);
  assert.equal(gapped[1].startMs, 25 * TICK_MS);
});

test('historical ticks follow the same three-case contract, cacheable', async () => {
  const transport = {
    base: 'https://live.test',
    pathTemplate: '/live/t/{tick}/vehicles.json',
    updateSeconds: 30,
  };
  const doc = {
    schemaVersion: 1,
    fetchedAt: '2026-10-12T14:00:02.000Z',
    feedTimestamp: '2026-10-12T14:00:01.000Z',
    source: 'x',
    attribution: 'y',
    vehicles: [],
    invalidPositions: 0,
    tickId: 123,
  };
  const urls = [];
  const request = (url) => {
    urls.push(url);
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  const snapshot = await fetchHistoricalTick(transport, 123, request);
  assert.equal(snapshot.tickId, 123);
  assert.deepEqual(urls, ['https://live.test/live/t/123/vehicles.json']);

  // 404: a missing tick is a null, never a throw — the replay skips gaps.
  assert.equal(
    await fetchHistoricalTick(transport, 1, () => new Response('gone', { status: 404 })),
    null,
  );

  // Any other status throws for the caller's backoff.
  await assert.rejects(
    fetchHistoricalTick(transport, 1, () => new Response('', { status: 500 })),
  );
  // An invalid document is rejected, not served.
  await assert.rejects(
    fetchHistoricalTick(
      transport,
      1,
      () => new Response(JSON.stringify({ schemaVersion: 2 }), { status: 200 }),
    ),
  );
});
