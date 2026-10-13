import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// E1S1 (docs/optimize-overlay.md): the pure stops tick-document contract —
// the same harness the vehicles tick-doc tests use (bundle the TS, import
// the bytes). The recorder shell only plumbs I/O; every decision is here.

const compiled = await build({
  stdin: {
    contents: `
  export * from "./workers/api/src/service/stops-tick-doc";`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const { buildStopsTickDocument, assembleStopsPayload, wireReadyStopState, tickIdAt } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );

// Fixture directional-stop state (shared/service/contracts StopServiceState).
const stopState = (stopId, overrides = {}) => ({
  stopId,
  directionId: 1,
  state: 'due',
  lastTouchAt: 1_800_000_000_000,
  minutesSince: 6.123456789,
  medianHeadwayOwnSeconds: 301.23456789,
  irregularity: 0.41234567,
  expectedWaitSeconds: 240.1234567,
  dryness: 1.21234567,
  backToBack: 1,
  routeIds: ['506'],
  coverage: { kind: 'observable', unmonitoredSeconds: 0, since: null },
  ...overrides,
});

const touch = (stopId, routeId) => ({
  t: 1_800_000_000_000,
  stopId,
  directionId: 1,
  mode: 'streetcar',
  vehicleId: '4401',
  routeId,
});

test('E1S1: states publish with tickId, grid-quantized at, and wire-rounded fields', () => {
  const doc = buildStopsTickDocument([stopState('st_a'), stopState('st_b')], 60_000, {
    tickMs: 30_000,
  });
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.tickId, 60_000);
  // `at` is the tick start — the same quantization /states always served.
  assert.equal(doc.at, 60_000 * 30_000);
  assert.equal(doc.outage, undefined);
  assert.equal(doc.states.length, 2);
  const [a] = doc.states;
  assert.equal(a.minutesSince, 6.123);
  assert.equal(a.medianHeadwayOwnSeconds, 301.235);
  assert.equal(a.irregularity, 0.4123);
  assert.equal(a.expectedWaitSeconds, 240.123);
  assert.equal(a.dryness, 1.2123);
  // The identity fields ride along untouched.
  assert.equal(a.stopId, 'st_a');
  assert.equal(a.state, 'due');
  assert.deepEqual(a.coverage, {
    kind: 'observable',
    unmonitoredSeconds: 0,
    since: null,
  });
});

test('E1S1: a recorder that cannot assemble publishes an outage doc — honest, cacheable', () => {
  const doc = buildStopsTickDocument(null, 4_000, { tickMs: 30_000 });
  assert.deepEqual(doc.states, []);
  assert.equal(doc.tickId, 4_000);
  // since = the start of the tick that could not assemble (grid-derivable).
  assert.equal(doc.outage.since, new Date(4_000 * 30_000).toISOString());
  assert.equal(doc.outage.tickId, 4_000);
  assert.equal(doc.at, 4_000 * 30_000);
  assert.equal(doc.schemaVersion, 1);
});

test('E1S1: an empty window is NOT an outage — it publishes as-is', () => {
  const doc = buildStopsTickDocument([], 5);
  assert.deepEqual(doc.states, []);
  assert.equal(doc.outage, undefined);
  assert.equal(doc.tickId, 5);
});

test('E1S1: wire rounding is idempotent and null-honest', () => {
  const rounded = wireReadyStopState(stopState('st_a'));
  assert.deepEqual(wireReadyStopState(rounded), rounded);
  const blind = wireReadyStopState(
    stopState('st_blind', {
      state: 'unmonitored',
      minutesSince: null,
      medianHeadwayOwnSeconds: null,
      irregularity: null,
      expectedWaitSeconds: null,
      dryness: null,
    }),
  );
  // A blind stop keeps its nulls — never a fabricated number.
  assert.equal(blind.state, 'unmonitored');
  assert.equal(blind.minutesSince, null);
  assert.equal(blind.dryness, null);
  assert.equal(blind.expectedWaitSeconds, null);
});

test('E1S2: the payload assembly merges touch routes with network routes, sorted, in map order', () => {
  const states = new Map([
    ['st_a', stopState('st_a', { routeIds: ['506'] })],
    ['st_b', stopState('st_b', { routeIds: [] })],
  ]);
  const touches = [touch('st_a', '306'), touch('st_a', '506'), touch('st_ghost', '505')];
  const networkRoutes = (stopId) => (stopId === 'st_a' ? ['505'] : []);
  const payload = assembleStopsPayload(states, touches, networkRoutes);
  // Map iteration order, one payload state per live state.
  assert.deepEqual(
    payload.map((state) => state.stopId),
    ['st_a', 'st_b'],
  );
  // Touch routes ∪ network routes, sorted — day and night stay distinct.
  assert.deepEqual(payload[0].routeIds, ['306', '505', '506']);
  // A stop with no touches and no network routes keeps an empty list.
  assert.deepEqual(payload[1].routeIds, []);
  // Wire rounding is applied by the assembly itself (E1S2: one rounding,
  // shared by the interim route and the published document).
  assert.equal(payload[0].minutesSince, 6.123);
  // Deterministic: same inputs, same bytes.
  assert.deepEqual(assembleStopsPayload(states, touches, networkRoutes), payload);
});

test('E1S1: tick derivation is the shared floor(epoch / (seconds*1000)) grid', () => {
  const tickMs = 30_000;
  assert.equal(tickIdAt(0, 30), 0);
  assert.equal(tickIdAt(tickMs - 1, 30), 0);
  assert.equal(tickIdAt(tickMs, 30), 1);
  // Skewed clocks land one tick ahead — the client's 404 → tick−1 path.
  assert.equal(tickIdAt(tickMs + 5_000, 30), 1);
});

test('E1S3: the published document stays within the size discipline at ~3k stops', () => {
  const bigStates = Array.from({ length: 3000 }, (_, index) =>
    stopState(`5_${String(index).padStart(6, '0')}_E`, { routeIds: ['506'] }),
  );
  const doc = buildStopsTickDocument(bigStates, 60_000);
  const bytes = JSON.stringify(doc).length;
  assert.ok(bytes > 100_000, 'expected a realistic payload');
  // Worst case (every directional stop active at once — far beyond a real
  // 30-minute window) stays under a megabyte, matching the fleet endpoint's
  // size discipline; wire rounding keeps it there.
  assert.ok(bytes < 1_000_000, `payload too large: ${bytes} bytes`);
});
