import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { compileModules } from '../helpers/compile.mjs';
import { createDatabase } from '../helpers/database.mjs';

const {
  api,
  openApiDocument,
  createApiClient,
  buildStreetcarMapBundle,
  buildViewerData,
  buildSnakeMap,
  nearbyStops,
  storeMapArtifact,
  storeStopDirectory,
  ownedAccountResponse,
  pruneOldNetworkVersions,
} = await compileModules(`
  export { default as api } from './workers/api/src/index';
  export { openApiDocument } from './workers/api/src/contracts/openapi';
  export { createApiClient } from './web/ui/services/http/client';
  export { buildStreetcarMapBundle } from './workers/api/src/mapgen/layout/build-map';
  export { buildViewerData } from './shared/map/model';
  export { buildSnakeMap } from './shared/map/game-map';
  export { nearbyStops } from './shared/transit/nearby';
  export { storeMapArtifact } from './workers/api/src/mapgen/artifacts/artifact-store';
  export { storeStopDirectory } from './workers/api/src/mapgen/artifacts/stop-directory-store';
  export { ownedAccountResponse } from './workers/api/src/accounts';
  export { pruneOldNetworkVersions } from './workers/api/src/sync/network-lifecycle';
`);
const sql = (
  await Promise.all(
    (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => readFile(`migrations/${name}`, 'utf8')),
  )
).join('\n');
const ajv = addFormats(new Ajv({ strict: false, allErrors: true }));
ajv.addSchema({ $id: 'ttc-contract', components: openApiDocument.components });
const validate = (name, value) => {
  const schema = ajv.getSchema(`ttc-contract#/components/schemas/${name}`);
  assert.ok(schema(value), JSON.stringify(schema.errors));
};
const source = {
  version: { id: 7, source_url: 'fixture', fetched_at: '2026-10-12T17:00:00.000Z' },
  routes: [
    {
      route_id: '501',
      short_name: '501',
      long_name: 'Queen',
      route_type: 0,
      color: 'D71920',
      text_color: 'FFFFFF',
    },
  ],
  shapes: [{ shape_id: 'rail', points_json: '[[43.65,-79.401],[43.65,-79.399]]' }],
  patterns: [0, 1].map((direction_id) => ({
    pattern_id: `p${direction_id}`,
    route_id: '501',
    direction_id,
    shape_id: 'rail',
    headsign: direction_id ? 'West' : 'East',
    trip_count: 1,
  })),
  stops: [
    {
      stop_id: 'west',
      name: 'Queen West',
      lat: 43.65003,
      lon: -79.4001,
      parent_station: 'station',
      wheelchair_boarding: 2,
    },
    {
      stop_id: 'east',
      name: 'Queen East',
      lat: 43.65006,
      lon: -79.39995,
      parent_station: 'station',
      wheelchair_boarding: 1,
    },
  ],
  patternStops: [0, 1].map((direction) => ({
    pattern_id: `p${direction}`,
    stop_id: direction ? 'west' : 'east',
    stop_sequence: 1,
  })),
  overlays: [],
};

test('original boarding geography survives grouping and game layout; all published schemas compile', () => {
  for (const name of Object.keys(openApiDocument.components.schemas))
    assert.ok(ajv.getSchema(`ttc-contract#/components/schemas/${name}`), name);
  const bundle = buildStreetcarMapBundle(source, 'fixture');
  const viewer = buildViewerData(bundle);
  const board = buildSnakeMap(viewer).data;
  validate('SchematicMap', bundle);
  validate('ViewerMap', board);
  validate('StopDirectory', board.stopDirectory);
  assert.deepEqual(board.stopDirectory, viewer.stopDirectory);
  for (const row of source.stops) {
    const published = board.stopDirectory.stops.find(
      (stop) => stop.stopId === row.stop_id,
    );
    assert.equal(published.latitude, row.lat);
    assert.equal(published.longitude, row.lon);
    assert.equal(published.parentStationId, 'station');
    assert.equal(published.services[0].directionId, row.stop_id === 'west' ? 1 : 0);
    const feature = board.features.find(
      (feature) => feature.id === published.displayFeatureId,
    );
    // Deliberately move the display by kilometres. Proximity still uses boarding geography.
    feature.point = [100000, -100000];
  }
  const here = { latitude: source.stops[0].lat, longitude: source.stops[0].lon };
  assert.equal(nearbyStops(board, here)[0].metres, 0);
  assert.ok(nearbyStops(board, here, true)[0].metres > 5);
  assert.equal(nearbyStops(board, { latitude: NaN, longitude: 0 }).length, 0);
});

test('device transport blocks coordinates and grid keys before sending; API rejects unexpected queries and event fields', async () => {
  const sent = [];
  const client = createApiClient({
    origin: 'https://ttcstatus.ca',
    fetch: async (url, init) => {
      sent.push({ url, body: init.body });
      return Response.json({});
    },
  });
  for (const field of [
    'latitude',
    'longitude',
    'accuracy',
    'geohash',
    'quadrant',
    'cellId',
    'bbox',
  ]) {
    await assert.rejects(client(`/api/v1/stops?${field}=43.65003`));
    await assert.rejects(
      client('/api/v1/event', {
        method: 'POST',
        body: JSON.stringify({ action: 'located', [field]: 'private' }),
      }),
    );
    const response = await api.fetch(
      new Request(`https://ttcstatus.ca/api/v1/stops?${field}=private`),
      {},
      {},
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'unsupported-query-parameter');
  }
  await assert.rejects(
    client('/api/v1/me/journal', {
      method: 'PUT',
      body: JSON.stringify({
        entries: [
          {
            vehicleId: '4400',
            label: '4400',
            recordedAt: '2026-10-12T17:00:00.000Z',
            note: '',
            latitude: 43.65,
          },
        ],
        revision: 0,
      }),
    }),
  );
  assert.equal(sent.length, 0);
  const points = [];
  const response = await api.fetch(
    new Request('https://ttcstatus.ca/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"action":"located","quadrant":"secret"}',
    }),
    { ANALYTICS: { writeDataPoint: (point) => points.push(point) } },
    {},
  );
  assert.equal(response.status, 400);
  assert.equal(points.length, 0);
  await client('/api/v1/event', { method: 'POST', body: '{"action":"located"}' });
  assert.deepEqual(sent, [
    { url: 'https://ttcstatus.ca/api/v1/event', body: '{"action":"located"}' },
  ]);
});

test('CORS covers PUT preflight, private errors and owner-only current-state conflicts', async () => {
  const env = { DB: createDatabase(sql) };
  const ctx = { waitUntil() {} };
  const preflight = await api.fetch(
    new Request('https://ttcstatus.ca/api/v1/me/stops', {
      method: 'OPTIONS',
      headers: {
        origin: 'capacitor://localhost',
        'access-control-request-method': 'PUT',
      },
    }),
    env,
    ctx,
  );
  assert.equal(preflight.status, 204);
  assert.ok(preflight.headers.get('access-control-allow-methods').includes('PUT'));
  const write = (ids, revision) =>
    ownedAccountResponse(
      new Request('https://ttcstatus.ca/api/v1/me/stops', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stopIds: ids, revision }),
      }),
      env,
      'owner',
    );
  assert.equal((await write(['east'], 0)).status, 200);
  const conflict = await write(['west'], 0);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get('access-control-allow-origin'), '*');
  assert.equal(conflict.headers.get('cache-control'), 'no-store');
  const body = await conflict.json();
  validate('SavedStopsConflict', body);
  assert.deepEqual(body, {
    error: 'saved-stops-conflict',
    revision: 1,
    current: { stopIds: ['east'], revision: 1 },
  });
  const unauthorized = await api.fetch(
    new Request('https://ttcstatus.ca/api/v1/me/stops'),
    env,
    ctx,
  );
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), '*');
});

test('manifest pins a complete directory and map to one immutable artifact across tag changes', async () => {
  const env = { DB: createDatabase(sql), SOURCE_ATTRIBUTION: 'fixture' };
  const viewer = buildViewerData(buildStreetcarMapBundle(source, 'fixture'));
  const first = await storeMapArtifact(env, 7, viewer, {
    name: 'ttcstatus',
    style: 'ttcstatus-board-v1',
  });
  await assert.rejects(
    storeStopDirectory(env, first, { ...viewer.stopDirectory, networkVersion: 999 }),
    /match/,
  );
  await storeStopDirectory(env, first, viewer.stopDirectory);
  const second = await storeMapArtifact(
    env,
    8,
    { ...viewer, networkVersion: 8 },
    { name: 'ttcstatus', style: 'ttcstatus-board-v1' },
  );
  await env.DB.prepare(
    "INSERT INTO map_tags (name, tag, artifact_id, updated_at) VALUES ('ttcstatus', 'stable', ?, 'now')",
  )
    .bind(first)
    .run();
  const entries = new Map(),
    tasks = [];
  const original = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async (key) => entries.get(key.url)?.clone(),
      put: async (key, value) => entries.set(key.url, value),
    },
  };
  const ctx = { waitUntil: (task) => tasks.push(task) };
  const get = (path, init) =>
    api.fetch(new Request(`https://ttcstatus.ca${path}`, init), env, ctx);
  try {
    const manifest = await (await get('/api/v1/manifest')).json();
    validate('ReleaseManifest', manifest);
    assert.equal(manifest.artifactId, first);
    await env.DB.prepare("UPDATE map_tags SET artifact_id = ? WHERE name = 'ttcstatus'")
      .bind(second)
      .run();
    const response = await get(manifest.stops.url);
    validate('StopDirectory', await response.clone().json());
    assert.equal(response.headers.get('x-map-artifact'), String(first));
    assert.match(response.headers.get('cache-control'), /immutable/);
    const map = await get(manifest.map.url);
    assert.equal(map.headers.get('x-map-artifact'), String(first));
    assert.ok(
      map.headers.get('access-control-expose-headers').includes('X-Network-Version'),
    );
    await Promise.all(tasks);
    assert.equal(
      (
        await get(manifest.stops.url, {
          headers: { 'if-none-match': `W/${response.headers.get('etag')}` },
        })
      ).status,
      304,
    );
    assert.equal(await (await get(manifest.stops.url, { method: 'HEAD' })).text(), '');
    assert.equal((await get('/api/v1/map/ttcstatus?artifact=NaN')).status, 400);
    assert.equal((await get(`/api/v1/stops?map=snake&artifact=${first}`)).status, 404);
    const reused = await storeMapArtifact(
      env,
      7,
      { changed: true },
      { name: 'ttcstatus', style: 'ttcstatus-board-v1' },
    );
    assert.equal(reused, first);
    assert.equal((await get(manifest.map.url)).headers.get('etag'), manifest.map.etag);
    assert.deepEqual(
      await (await get('/api/v1/openapi.json')).json(),
      JSON.parse(await readFile('docs/api/openapi.json', 'utf8')),
    );
  } finally {
    globalThis.caches = original;
  }
});

test('retention preserves tagged maps and directories while pruning obsolete raw networks', async () => {
  const env = {
    DB: createDatabase(sql),
    SOURCE_ATTRIBUTION: 'fixture',
    GTFS_BUCKET: { delete: async () => {} },
  };
  for (const id of [1, 2, 3])
    await env.DB.prepare(
      "INSERT INTO network_versions (id, source_key, source_url, r2_etag, r2_key, fetched_at, status) VALUES (?, 'ttc-surface-gtfs', 'fixture', ?, ?, 'now', 'imported')",
    )
      .bind(id, String(id), String(id))
      .run();
  const viewer = buildViewerData(buildStreetcarMapBundle(source, 'fixture'));
  const id = await storeMapArtifact(env, 1, { ...viewer, networkVersion: 1 });
  await storeStopDirectory(env, id, { ...viewer.stopDirectory, networkVersion: 1 });
  await env.DB.prepare("INSERT INTO map_tags VALUES ('streetcar', 'stable', ?, 'now')")
    .bind(id)
    .run();
  await pruneOldNetworkVersions(env);
  assert.ok(
    await env.DB.prepare('SELECT etag FROM map_stop_directories WHERE artifact_id = ?')
      .bind(id)
      .first(),
  );
});

test('E6S1: location-bearing query parameters are rejected on every public path', async () => {
  // The 2027 tripwire: `?lat=&lon=` on ANY path — allowlisted selector or
  // not, existing route or not, future live-host-shaped route included —
  // dies before routing, auth, or caching with the same 400.
  for (const path of [
    '/api/v1/stops', // allowlist exists (map/tag/artifact) — lat is not in it
    '/api/v1/stops?map=snake', // legitimate selector alongside the poison
    '/api/v1/auth/config', // no allowlist entry at all
    '/live/t/123/vehicles.json', // a live-host-shaped route, if one ever lands here
    '/anything/else', // unknown paths reject location too
  ]) {
    for (const field of [
      'lat',
      'LAT',
      'latitude',
      'lng',
      'longitude',
      'geohash',
      'cellId',
    ]) {
      const response = await api.fetch(
        new Request(
          `https://ttcstatus.ca${path}${path.includes('?') ? '&' : '?'}${field}=43.65`,
        ),
        {},
        {},
      );
      assert.equal(response.status, 400, `${path} ${field}`);
      assert.equal((await response.json()).error, 'unsupported-query-parameter');
    }
  }
  // Legitimate selectors still pass: the rejection is location-only.
  const fine = await api.fetch(
    new Request('https://ttcstatus.ca/api/v1/stops?map=snake'),
    {},
    {},
  );
  assert.notEqual(fine.status, 400);
});

test('failure logs omit exception text, query tokens and dynamic identifiers', async () => {
  const recorded = [],
    original = console.error;
  console.error = (...args) => recorded.push(args);
  try {
    const response = await api.fetch(
      new Request('https://ttcstatus.ca/api/v1/map/ttcstatus?tag=private-quadrant'),
      {
        DB: {
          prepare() {
            throw new Error('latitude=43.65003 longitude=-79.4001 secret');
          },
        },
      },
      {},
    );
    assert.equal(response.status, 500);
    assert.deepEqual(recorded, [
      [
        'unhandled request failure',
        { method: 'GET', route: '/api/v1/map/ttcstatus', errorType: 'Error' },
      ],
    ]);
  } finally {
    console.error = original;
  }
});
