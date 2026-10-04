import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import GtfsBindings from 'gtfs-realtime-bindings';

const compiled = await build({
  stdin: {
    contents: `
  export * from "./shared/map/projection";
  export * from "./shared/live/vehicles";
  export * from "./workers/api/src/realtime/realtime";
  export { default as apiWorker } from "./workers/api/src/index";
  export * from "./shared/map/live-status";
  export * from "./shared/map/model";
  export { projectToLocalMetres } from "./shared/map/geometry";`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const {
  gpsToMap,
  mapToGps,
  localToMap,
  fitGeographicTransform,
  transformSegment,
  matchGpsToTrack,
  pointAlongEdge,
  projectToLocalMetres,
  decodeVehicleSnapshot,
  vehicleIsStale,
  buildViewerData,
  projectSnapshot,
  streetcarBody,
  fetchVehicleSnapshot,
  apiWorker,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const now = new Date('2026-10-03T20:00:00Z'),
  timestamp = now.getTime() / 1000;
const encode = (entity, header = {}) =>
  GtfsBindings.transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp, ...header },
    entity,
  }).finish();
const observation = (id, extra = {}) => ({
  id: `entity-${id}`,
  vehicle: {
    vehicle: { id },
    position: { latitude: 43.65, longitude: -79.38 },
    timestamp,
    ...extra,
  },
});
const gpsFromLocal = ([x, y]) => [
  43.65 + y / 110540,
  -79.38 + x / (111320 * Math.cos((43.65 * Math.PI) / 180)),
];
const makeEdge = (id, a, b, routeIds = [], nodes = [id + 'a', id + 'b']) => {
  const lengthMetres = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    id,
    a: nodes[0],
    b: nodes[1],
    routeIds,
    sourcePoints: [a, b],
    points: [a, b],
    sourceDistances: [0, lengthMetres],
    lengthMetres,
  };
};

test('decoder selects all Flexity cars including unscheduled ones, excludes replacement buses, preserves optional fields', () => {
  const snapshot = decodeVehicleSnapshot(
    encode([
      observation('4400'),
      observation('4663', {
        trip: { routeId: '501', tripId: 'trip' },
        position: { latitude: 43.65, longitude: -79.38, bearing: 0, speed: 0 },
      }),
      observation('8000', { trip: { routeId: '501' } }),
    ]),
    'fixture',
    'attribution',
    now,
  );
  assert.deepEqual(
    snapshot.vehicles.map((v) => v.id),
    ['4400', '4663'],
  );
  assert.equal(snapshot.vehicles[0].routeId, undefined);
  assert.equal(snapshot.vehicles[0].bearing, undefined);
  assert.equal(snapshot.vehicles[0].speedMetresPerSecond, undefined);
  assert.equal(snapshot.vehicles[1].bearing, 0);
  assert.equal(snapshot.feedTimestamp, now.toISOString());
});
test('decoder keeps the newest duplicate and reports unusable fixes', () => {
  const snapshot = decodeVehicleSnapshot(
    encode([
      observation('4400', { timestamp: timestamp - 60 }),
      observation('4400'),
      observation('4401', { position: { latitude: 100, longitude: 0 } }),
      observation('4402', { position: null }),
      observation('4403', { position: { latitude: 43.65 } }),
      { ...observation('4404'), isDeleted: true },
    ]),
    'fixture',
    '',
    now,
  );
  assert.equal(snapshot.vehicles.length, 1);
  assert.equal(snapshot.vehicles[0].observedAt, now.toISOString());
  assert.equal(snapshot.invalidPositions, 3);
});
test('decoder rejects malformed and differential feeds instead of showing a false empty fleet', () => {
  assert.throws(() => decodeVehicleSnapshot(new Uint8Array([255]), '', ''));
  assert.throws(
    () => decodeVehicleSnapshot(encode([], { incrementality: 1 }), '', ''),
    /differential/,
  );
});
test('staleness uses observation time, supports header time, and treats unknown/future timestamps as uncertain', () => {
  const snapshot = decodeVehicleSnapshot(encode([observation('4400')]), '', '', now),
    car = snapshot.vehicles[0];
  assert.equal(vehicleIsStale(car, snapshot, now.getTime()), false);
  assert.equal(vehicleIsStale(car, snapshot, now.getTime() + 121000), true);
  assert.equal(
    vehicleIsStale({ ...car, observedAt: null }, snapshot, now.getTime()),
    false,
  );
  assert.equal(
    vehicleIsStale(
      { ...car, observedAt: null },
      { ...snapshot, feedTimestamp: null },
      now.getTime(),
    ),
    true,
  );
  assert.equal(vehicleIsStale(car, snapshot, now.getTime() - 61000), true);
});
test('serialized geographic transform agrees with every retained Toronto track vertex', async () => {
  const map = JSON.parse(
    await readFile('data/fixtures/streetcar-schematic.json', 'utf8'),
  );
  const transform = map.display.geographicTransform;
  for (const edge of map.graph.edges) {
    assert.deepEqual(localToMap(edge.sourcePoints[0], transform), edge.points[0]);
    assert.deepEqual(localToMap(edge.sourcePoints.at(-1), transform), edge.points.at(-1));
  }
  const gps = [43.65, -79.38];
  assert.deepEqual(
    gpsToMap(...gps, transform),
    localToMap(projectToLocalMetres(gps), transform),
  );
  assert.throws(() => gpsToMap(NaN, -79.38, transform), /Invalid GPS/);
});
test('distance interpolation follows warp boundaries instead of a straight display chord', () => {
  const a = [-9000, 0],
    b = [9000, 0],
    transform = fitGeographicTransform([a, b], 1600, 1100, 16);
  const edge = { ...makeEdge('warp', a, b), ...transformSegment(a, b, transform) };
  for (const s of [0, 3000, 6500, 9000, 12000, 18000]) {
    const point = pointAlongEdge(edge, s).point,
      expected = localToMap([a[0] + s, 0], transform);
    assert.ok(Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 0.02);
  }
});
test('GPS round trips preserve downtown, outer network and free user locations within a metre', () => {
  const transform = fitGeographicTransform(
    [
      [-15000, -7000],
      [9000, 8000],
    ],
    1600,
    1100,
    16,
  );
  for (const [latitude, longitude] of [
    [43.65, -79.38],
    [43.5919323, -79.5441246],
    [43.6815049, -79.2848082],
    [43.662, -79.401],
  ]) {
    const result = mapToGps(gpsToMap(latitude, longitude, transform), transform);
    const a = projectToLocalMetres([latitude, longitude]),
      b = projectToLocalMetres([result.latitude, result.longitude]);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1);
  }
});
test('route, bearing and continuity resolve nearby corridors while permitting diversions', () => {
  const queen = makeEdge('queen', [-100, 0], [100, 0], ['501']),
    king = makeEdge('king', [-100, 20], [100, 20], ['504']);
  const gps = gpsFromLocal([0, 12]);
  assert.equal(
    matchGpsToTrack([queen, king], ...gps, { routeId: '501' }).edgeId,
    'queen',
  );
  assert.equal(
    matchGpsToTrack([queen, king], ...gps, { previousEdgeId: 'queen' }).edgeId,
    'queen',
  );
  const north = makeEdge('north', [0, -100], [0, 100], ['510']);
  assert.equal(
    matchGpsToTrack([queen, north], ...gpsFromLocal([0, 0]), { bearing: 0 }).edgeId,
    'north',
  );
  assert.equal(
    matchGpsToTrack([queen], ...gpsFromLocal([0, 0]), { bearing: 270 }).direction,
    -1,
  );
  const diversion = makeEdge('diversion', [-100, 300], [100, 300]);
  assert.equal(
    matchGpsToTrack([queen, diversion], ...gpsFromLocal([0, 300]), { routeId: '501' })
      .edgeId,
    'diversion',
  );
  assert.equal(matchGpsToTrack([queen], ...gpsFromLocal([0, 500])), undefined);
  assert.equal(matchGpsToTrack([queen], NaN, 0), undefined);
});
test('projection preserves off-network and stale cars instead of forcing them onto distant rail', async () => {
  const map = buildViewerData(
    JSON.parse(await readFile('data/fixtures/streetcar-schematic.json', 'utf8')),
  );
  const snapshot = decodeVehicleSnapshot(
    encode([
      observation('4400', {
        position: { latitude: 43.72, longitude: -79.55 },
        timestamp: timestamp - 300,
      }),
    ]),
    '',
    '',
    now,
  );
  const cars = projectSnapshot(map, snapshot, now.getTime());
  assert.equal(cars.length, 1);
  assert.equal(cars[0].match, undefined);
  assert.equal(cars[0].stale, true);
  assert.deepEqual(
    cars[0].point,
    gpsToMap(
      snapshot.vehicles[0].latitude,
      snapshot.vehicles[0].longitude,
      map.geographicTransform,
    ),
  );
});
test('five body sections follow a connected bend and never jump a geometric crossing', () => {
  const edges = [
    makeEdge('east', [0, 0], [100, 0], ['501'], ['corner', 'east']),
    makeEdge('south', [0, -100], [0, 0], ['501'], ['south', 'corner']),
    makeEdge('crossing', [-20, -20], [20, 20], [], ['x', 'y']),
  ];
  const match = matchGpsToTrack(edges, ...gpsFromLocal([3, 0]), {
    routeId: '501',
    bearing: 90,
  });
  const body = streetcarBody(
    {
      vehicle: { id: '4400', routeId: '501' },
      point: match.point,
      match,
      angle: match.angle,
    },
    edges,
    1,
  );
  assert.equal(body.length, 5);
  assert.ok(
    body
      .slice(1)
      .every((section) => Math.abs(section.point[0]) < 0.001 && section.point[1] < 0),
  );
});
test('acquisition handles upstream failure and size limits', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await assert.rejects(fetchVehicleSnapshot('fixture', ''), /503/);
    globalThis.fetch = async () => new Response(new Uint8Array(5_000_001));
    await assert.rejects(fetchVehicleSnapshot('fixture', ''), /too large/);
    globalThis.fetch = async () => new Response(encode([observation('4400')]));
    assert.equal((await fetchVehicleSnapshot('fixture', '')).vehicles.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('public vehicle endpoint returns CORS JSON, reuses its edge cache and never accesses D1', async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  const entries = new Map(),
    tasks = [],
    ctx = { waitUntil: (task) => tasks.push(task) };
  const env = {
    SOURCE_ATTRIBUTION: 'fixture',
    DB: {
      prepare() {
        throw new Error('Vehicle reads must not query static D1');
      },
    },
  };
  let upstreamCalls = 0;
  try {
    globalThis.caches = {
      default: {
        match: async (key) => entries.get(key.url)?.clone(),
        put: async (key, response) => entries.set(key.url, response),
      },
    };
    globalThis.fetch = async () => {
      upstreamCalls++;
      return new Response(encode([observation('4400')]));
    };
    const request = new Request('https://api.example/api/v1/vehicles/streetcar');
    const first = await apiWorker.fetch(request, env, ctx);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('access-control-allow-origin'), '*');
    assert.match(first.headers.get('cache-control'), /^public, max-age=(29|30)$/);
    assert.equal(first.headers.get('x-live-update-seconds'), '30');
    assert.equal((await first.json()).vehicles[0].id, '4400');
    await Promise.all(tasks);
    assert.equal((await apiWorker.fetch(request, env, ctx)).status, 200);
    assert.equal(upstreamCalls, 2);
    const unchanged = await apiWorker.fetch(
      new Request(request.url, {
        headers: { 'if-none-match': first.headers.get('etag') },
      }),
      env,
      ctx,
    );
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');
    assert.equal(unchanged.headers.get('x-live-update-seconds'), '30');
    assert.equal(upstreamCalls, 2);
    const etag = first.headers.get('etag');
    // Compression can change the browser's validator to W/"...". Exercise
    // both edge-cache hits and misses that reuse the isolate's snapshot.
    for (const edgeHit of [true, false]) {
      if (!edgeHit) entries.clear();
      for (const validator of [`W/${etag}`, `"older", W/${etag}`, '*']) {
        const response = await apiWorker.fetch(
          new Request(request.url, { headers: { 'if-none-match': validator } }),
          env,
          ctx,
        );
        assert.equal(response.status, 304, `${validator}, edge hit: ${edgeHit}`);
        assert.equal(await response.text(), '');
        assert.equal(response.headers.get('etag'), etag);
        assert.equal(
          response.headers.get('x-live-next-update-at'),
          first.headers.get('x-live-next-update-at'),
        );
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        if (!edgeHit) entries.clear();
      }
    }
    const different = await apiWorker.fetch(
      new Request(request.url, { headers: { 'if-none-match': 'W/"different"' } }),
      env,
      ctx,
    );
    assert.equal(different.status, 200);
    assert.equal((await different.json()).vehicles[0].id, '4400');
    assert.equal(upstreamCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
test('public endpoint makes upstream failure an uncached 503 while the static map remains independent', async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches,
    originalError = console.error;
  try {
    console.error = () => {};
    globalThis.caches = {
      default: {
        match: async () => undefined,
        put: () => {
          throw new Error('Do not cache failures');
        },
      },
    };
    globalThis.fetch = async () => new Response('down', { status: 502 });
    const response = await apiWorker.fetch(
      new Request('https://api.example/api/v1/vehicles/streetcar'),
      { SOURCE_ATTRIBUTION: '' },
      {
        waitUntil() {
          throw new Error('Do not cache failures');
        },
      },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error, 'vehicles-unavailable');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    console.error = originalError;
  }
});
test('runtime interval changes invalidate old cache entries and advertise the five-minute cadence', async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  let calls = 0;
  const entries = new Map(),
    tasks = [];
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(encode([observation('4400')]));
    };
    globalThis.caches = {
      default: {
        match: async (key) => entries.get(key.url)?.clone(),
        put: async (key, response) => entries.set(key.url, response),
      },
    };
    const env = { SOURCE_ATTRIBUTION: 'interval-test', REALTIME_UPDATE_SECONDS: '30' },
      ctx = { waitUntil: (task) => tasks.push(task) },
      request = new Request('https://api.example/api/v1/vehicles/streetcar');
    const first = await apiWorker.fetch(request, env, ctx);
    await Promise.all(tasks);
    const second = await apiWorker.fetch(
      new Request(request.url, {
        headers: { 'if-none-match': first.headers.get('etag') },
      }),
      { ...env, REALTIME_UPDATE_SECONDS: '300' },
      ctx,
    );
    assert.equal(calls, 4);
    assert.equal(second.status, 304);
    assert.equal(second.headers.get('x-live-update-seconds'), '300');
    assert.match(second.headers.get('cache-control'), /^public, max-age=(299|300)$/);
    assert.ok(
      second.headers
        .get('access-control-expose-headers')
        .includes('X-Live-Update-Seconds'),
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
