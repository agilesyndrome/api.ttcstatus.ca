import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../helpers/database.mjs';
import { compileModules } from '../helpers/compile.mjs';

// The Track A epic boundary (stories E1S2–E1S6, E6S1): everything through the
// SQLite harness — no DO runtime needed (story 1.7's design).
const {
  loadNetwork,
  processTick,
  initialRecorderState,
  serializeRecorderState,
  deserializeRecorderState,
  WindowStore,
  installFixtureNetwork,
  activateFixtureVersion,
  streetcarVehicle,
  railSnapshot,
  subwayPrediction,
  platformEast,
  platformWest,
  terminalEast,
  EAST_STOPS,
  WEST_STOPS,
  SUBWAY_STATIONS,
  serviceConfig,
} = await compileModules(`
  export { loadNetwork } from './workers/api/src/service/network';
  export { processTick, initialRecorderState, serializeRecorderState, deserializeRecorderState } from './workers/api/src/service/recorder-core';
  export { WindowStore } from './workers/api/src/service/window-store';
  export * from './workers/api/src/service/recorder-fixtures';
  export { serviceConfig } from './shared/service/config';
`);

const schema = await readFile('migrations/0001_initial.sql', 'utf8');
const config = serviceConfig();
const T0 = Math.floor(1_800_000_000_000 / 30_000) * 30_000; // tick-aligned

const sqlAdapter = (sqlite) => ({
  exec: (query, ...params) => {
    const statement = sqlite.prepare(query);
    const rows = params.length ? statement.all(...params) : statement.all();
    return { toArray: () => rows };
  },
});

const fixtureDb = async () => {
  const db = createDatabase(schema);
  await installFixtureNetwork(db, 1);
  return db;
};

test('E1S2: the network bootstraps from the active GTFS version', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  assert.equal(network.versionId, 1);
  assert.ok(network.stopsByRoute.get('506').includes(EAST_STOPS.A));
  assert.ok(network.stopsByRoute.get('506').includes(WEST_STOPS.A));
  assert.equal(network.stops.get(EAST_STOPS.A).directionId, 0);
  assert.equal(network.stops.get(WEST_STOPS.A).directionId, 1);
  assert.equal(network.patterns.get('506_E').directionId, 0);
  assert.deepEqual(network.patterns.get('2_E').stopIds, [...SUBWAY_STATIONS]);
  assert.ok(network.edgesByRoute.get('506').length >= 2);
  assert.ok(network.edges.every((edge) => edge.lengthMetres > 0));
});

test('E1S2: a nightly version flip reloads the network; stop ids stay stable', async () => {
  const db = await fixtureDb();
  const before = await loadNetwork(db);
  await installFixtureNetwork(db, 2);
  await activateFixtureVersion(db, 2);
  const after = await loadNetwork(db);
  assert.equal(before.versionId, 1);
  assert.equal(after.versionId, 2);
  // Unchanged stop IDs keep their identity across the flip (§4.6 rule 5).
  for (const stopId of before.stops.keys()) {
    assert.ok(after.stops.has(stopId), `stop ${stopId} lost in version flip`);
  }
});

test('E1S4: a confident fix is never credited to the wrong direction’s platform', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  const eastbound = streetcarVehicle('4401', platformEast, T0, { bearing: 90 });
  const output = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, [eastbound]),
    state,
  });
  assert.equal(output.touches.length, 1);
  const touch = output.touches[0];
  assert.equal(touch.stopId, EAST_STOPS.A);
  assert.equal(touch.directionId, 0);
  assert.equal(touch.ambiguous, undefined);
  // The opposite platform is 24 m away and was never credited.
  assert.notEqual(touch.stopId, WEST_STOPS.A);

  // Westbound at the westbound platform: direction follows the track.
  const westState = initialRecorderState();
  const westbound = streetcarVehicle('4402', platformWest, T0 + 30_000, { bearing: 270 });
  const west = processTick({
    now: T0 + 30_000,
    config,
    network,
    snapshot: railSnapshot(T0 + 30_000, [westbound]),
    state: westState,
  });
  assert.equal(west.touches[0].stopId, WEST_STOPS.A);
  assert.equal(west.touches[0].directionId, 1);
});

test('E1S4: an unresolvable platform assignment is flagged ambiguous, never guessed silently', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  // Mid-block on the eastbound track, 26 m west of B_W's longitude: only the
  // westbound platform is inside the 40 m radius, while the matched edge's
  // direction has no candidate — recorded with the honest diagnostic flag.
  const midBlockEast = { lat: platformEast.lat, lon: -79.398123 };
  const fix = streetcarVehicle('4403', midBlockEast, T0, { bearing: 90 });
  const output = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, [fix]),
    state: initialRecorderState(),
  });
  assert.equal(output.touches.length, 1);
  assert.equal(output.touches[0].ambiguous, true);
  assert.equal(output.touches[0].stopId, WEST_STOPS.B);
});

test('E1S3/E1S4: a terminal layover observed for 100 s is one service, not four', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  let total = 0;
  for (let tick = 0; tick <= 3; tick += 1) {
    const now = T0 + tick * 30_000;
    const parked = streetcarVehicle('4409', terminalEast, now, { bearing: 90 });
    const output = processTick({
      now,
      config,
      network,
      snapshot: railSnapshot(now, [parked]),
      state,
    });
    total += output.touches.length;
    // The state object is mutated in place; simulate persistence per tick.
  }
  assert.equal(total, 1);
  // After the ~2 min dwell window, a genuinely new service counts again.
  const later = T0 + 150_000;
  const departed = streetcarVehicle('4409', terminalEast, later, { bearing: 90 });
  const output = processTick({
    now: later,
    config,
    network,
    snapshot: railSnapshot(later, [departed]),
    state,
  });
  assert.equal(output.touches.length, 1);
  assert.equal(output.touches[0].t, Math.floor(later / 30_000) * 30_000);
});

test('E1S3: two distinct vehicles at one stop in one sample both count (h ≈ 0)', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const pair = [
    streetcarVehicle('4410', platformEast, T0),
    streetcarVehicle('4411', platformEast, T0),
  ];
  const output = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, pair),
    state: initialRecorderState(),
  });
  assert.equal(output.touches.length, 2);
  const [first, second] = output.touches;
  assert.equal(first.t, second.t);
  assert.notEqual(first.vehicleId, second.vehicleId);
  assert.equal(first.stopId, EAST_STOPS.A);
});

test('E1S3: stale fixes never generate touches (the 2-minute fleet rule)', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const stale = streetcarVehicle('4412', platformEast, T0 - 180_000, { bearing: 90 });
  const output = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, [stale]),
    state: initialRecorderState(),
  });
  assert.equal(output.touches.length, 0);
});

test('E1S5: subway prediction aging emits one touch per passed station, timestamped max(arrival, observed)', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  const first = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, [], {
      predictions: [
        subwayPrediction('T1', T0, [
          { stopId: SUBWAY_STATIONS[0], sequence: 1, arrivalAt: T0 + 10_000 },
          { stopId: SUBWAY_STATIONS[1], sequence: 2, arrivalAt: T0 + 40_000 },
        ]),
      ],
    }),
    state,
  });
  assert.equal(first.touches.length, 0); // first sight: nothing fabricated

  const second = processTick({
    now: T0 + 30_000,
    config,
    network,
    snapshot: railSnapshot(T0 + 30_000, [], {
      predictions: [
        subwayPrediction('T1', T0 + 30_000, [
          { stopId: SUBWAY_STATIONS[1], sequence: 2, arrivalAt: T0 + 55_000 },
          { stopId: SUBWAY_STATIONS[2], sequence: 3, arrivalAt: T0 + 90_000 },
        ]),
      ],
    }),
    state,
  });
  assert.equal(second.touches.length, 1);
  const touch = second.touches[0];
  assert.equal(touch.stopId, SUBWAY_STATIONS[0]);
  assert.equal(touch.mode, 'subway');
  assert.equal(touch.directionId, 0); // S1 → S2 follows the 2_E pattern order
  // max(arrivalAt = T0+10s, observedAt = T0+30s) = T0+30s.
  assert.equal(touch.t, T0 + 30_000);
});

test('E1S5: flapping predictions never double-count; a restart mid-route makes no phantoms', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  const step = (now, upcoming) =>
    processTick({
      now,
      config,
      network,
      snapshot: railSnapshot(now, [], {
        predictions: [subwayPrediction('T1', now, upcoming)],
      }),
      state,
    });
  step(T0, [
    { stopId: SUBWAY_STATIONS[0], sequence: 1, arrivalAt: T0 + 5_000 },
    { stopId: SUBWAY_STATIONS[1], sequence: 2, arrivalAt: T0 + 20_000 },
  ]);
  step(T0 + 30_000, [
    { stopId: SUBWAY_STATIONS[1], sequence: 2, arrivalAt: T0 + 35_000 },
  ]); // advanced past S1 → one S1 touch
  const flapped = step(T0 + 60_000, [
    { stopId: SUBWAY_STATIONS[0], sequence: 1, arrivalAt: T0 + 65_000 },
    { stopId: SUBWAY_STATIONS[1], sequence: 2, arrivalAt: T0 + 80_000 },
  ]); // flapped backwards → no touch
  assert.equal(flapped.touches.length, 0);
  const advanced = step(T0 + 90_000, [
    { stopId: SUBWAY_STATIONS[2], sequence: 3, arrivalAt: T0 + 95_000 },
  ]); // moved forward again; S1 was already touched → still nothing new
  assert.equal(advanced.touches.length, 0);
  assert.equal(state.subwayTouched.size, 1);

  // A train first seen mid-route (feed restart) gets no pre-sight touches.
  const restarted = initialRecorderState();
  const fresh = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, [], {
      predictions: [
        subwayPrediction('T2', T0, [
          { stopId: SUBWAY_STATIONS[2], sequence: 3, arrivalAt: T0 + 10_000 },
        ]),
      ],
    }),
    state: restarted,
  });
  assert.equal(fresh.touches.length, 0);
});

test('E1S5/E1S1: a silent subway feed is no-reports coverage, never a void', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  // Tick 1: subway observable (a train is reporting).
  processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(T0, [], {
      predictions: [
        subwayPrediction('T9', T0, [
          { stopId: SUBWAY_STATIONS[0], sequence: 1, arrivalAt: T0 + 10_000 },
        ]),
      ],
    }),
    state,
  });
  // Tick 2: feed up, zero reports — the silent Line 5/6 case.
  const silent = processTick({
    now: T0 + 30_000,
    config,
    network,
    snapshot: railSnapshot(T0 + 30_000, [], { subway: 'available', predictions: [] }),
    state,
  });
  assert.equal(silent.touches.length, 0);
  assert.equal(silent.counters.noReportTicks, 1);
  // The observable run closed; a no-reports run opened at the flip.
  assert.equal(state.coverageRuns.subway.kind, 'no-reports');
  assert.deepEqual(silent.coverageClosed, [
    { from: T0, to: T0 + 30_000, mode: 'subway', kind: 'observable' },
  ]);
});

test('E1S1: feed outages close coverage runs and never fabricate touches', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  processTick({ now: T0, config, network, snapshot: railSnapshot(T0, []), state });
  const outage = processTick({
    now: T0 + 30_000,
    config,
    network,
    snapshot: railSnapshot(T0 + 30_000, [], {
      surface: 'unavailable',
      subway: 'unavailable',
    }),
    state,
  });
  assert.equal(outage.touches.length, 0);
  assert.equal(outage.counters.outageTicks, 1);
  assert.equal(state.coverageRuns.streetcar.kind, 'outage');
  // Total feed loss (snapshot null) behaves identically: outage, no touches.
  const dark = processTick({
    now: T0 + 60_000,
    config,
    network,
    snapshot: null,
    state,
  });
  assert.equal(dark.touches.length, 0);
  assert.equal(dark.counters.outageTicks, 1);
});

test('E6S1: counters record touches by mode and coverage honesty', async () => {
  const db = await fixtureDb();
  const network = await loadNetwork(db);
  const state = initialRecorderState();
  const tick = processTick({
    now: T0,
    config,
    network,
    snapshot: railSnapshot(
      T0,
      [
        streetcarVehicle('4420', platformEast, T0),
        streetcarVehicle('4421', platformEast, T0),
      ],
      {
        predictions: [
          subwayPrediction('T3', T0, [
            { stopId: SUBWAY_STATIONS[0], sequence: 1, arrivalAt: T0 + 1_000 },
          ]),
        ],
      },
    ),
    state,
  });
  assert.equal(tick.counters.streetcarTouches, 2);
  assert.equal(tick.counters.subwayTouches, 0);
  assert.equal(tick.counters.outageTicks, 0);
  assert.equal(tick.counters.noReportTicks, 0);
});

test('E1S6: the window store round-trips, prunes exactly the window, and keeps folds derivable', () => {
  const store = new WindowStore(sqlAdapter(new DatabaseSync(':memory:')));
  store.initialize();
  const touch = (t, stopId, vehicleId) => ({
    t,
    stopId,
    directionId: 0,
    mode: 'streetcar',
    vehicleId,
    routeId: '506',
    ambiguous: true,
  });
  store.insertTouches([
    touch(T0 - 2_000_000, EAST_STOPS.A, 'old'),
    touch(T0 - 1_800_000, EAST_STOPS.A, 'boundary'), // exactly at the window edge: kept
    touch(T0 - 1_700_000, EAST_STOPS.A, 'inside'),
  ]);
  store.insertCoverage([
    { from: T0 - 2_000_000, to: T0 - 1_800_000, mode: 'streetcar', kind: 'outage' },
  ]);
  const pruned = store.prune(T0 - 1_800_000);
  assert.equal(pruned, 2); // the old touch + the aged coverage row
  const touches = store.loadTouches(T0 - 1_800_000);
  assert.equal(touches.length, 2);
  assert.equal(touches[0].vehicleId, 'boundary');
  assert.equal(touches[0].ambiguous, true); // the flag survives the round trip
  assert.equal(store.lastTouchAtBefore(EAST_STOPS.A, T0), T0 - 1_700_000);
  const coverage = store.loadCoverage();
  assert.equal(coverage.length, 0);
  // Stop-scoped loads give folds their per-bucket input.
  const scoped = store.loadStopTouches(EAST_STOPS.A, T0 - 1_800_000, T0);
  assert.equal(scoped.length, 2);
  // State rows round-trip for restart survival.
  store.saveState('{"coverageRuns":{"streetcar":null,"subway":null}}');
  assert.match(store.loadState(), /coverageRuns/);
});

test('E1S7: recorder state serializes and deserializes without losing a bit', () => {
  const state = initialRecorderState();
  state.lastEdgeByVehicle.set('4420', 'edge:506_E');
  state.lastTouchAt.set('4420|stop', T0);
  state.subwayUpcoming.set('T1', { stopId: 'st_2_S1', sequence: 1, arrivalAt: T0 });
  state.subwayTouched.add('T1|st_2_S1');
  state.coverageRuns.streetcar = { kind: 'observable', from: T0 };
  const restored = deserializeRecorderState(serializeRecorderState(state));
  assert.equal(restored.lastEdgeByVehicle.get('4420'), 'edge:506_E');
  assert.equal(restored.lastTouchAt.get('4420|stop'), T0);
  assert.equal(restored.subwayUpcoming.get('T1').stopId, 'st_2_S1');
  assert.ok(restored.subwayTouched.has('T1|st_2_S1'));
  assert.equal(restored.coverageRuns.streetcar.kind, 'observable');
  // Fresh state on empty storage (cold DO start).
  const fresh = deserializeRecorderState(null);
  assert.equal(fresh.lastEdgeByVehicle.size, 0);
  assert.equal(fresh.subwayTouched.size, 0);
});
