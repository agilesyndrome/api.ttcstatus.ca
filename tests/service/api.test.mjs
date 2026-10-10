import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

// Epic 3 boundary (stories E3S1–E3S3): the service endpoints through the real
// router, with the recorder singleton faked as a stub namespace serving
// corpus-derived payloads — exactly the layer contract the DO implements.
const { api, scenarioById, serviceStatesAt, serviceConfig, VOID_CORRIDOR_STOPS } =
  await compileModules(`
  export { default as api } from './workers/api/src/index';
  export * from './shared/service/fixtures';
  export { serviceStatesAt } from './shared/service/wait-metrics';
  export { serviceConfig } from './shared/service/config';
`);

const config = serviceConfig();

// A Map-backed edge cache, like the realtime suite's. The endpoint always
// stores a clone, so the stub keeps it as-is.
const cacheStore = new Map();
const cacheKeyOf = (key) =>
  typeof key === 'object' && key && 'url' in key ? key.url : String(key);
globalThis.caches = {
  default: {
    async match(key) {
      return cacheStore.get(cacheKeyOf(key)) ?? null;
    },
    async put(key, response) {
      cacheStore.set(cacheKeyOf(key), response);
    },
  },
};

function statesPayloadFor(scenario) {
  const states = serviceStatesAt(scenario.touches, scenario.coverage, {
    windowStart: scenario.windowStart,
    at: scenario.at,
    config,
  });
  const routesByStop = new Map();
  for (const touch of scenario.touches) {
    const bucket = routesByStop.get(touch.stopId) ?? new Set();
    bucket.add(touch.routeId);
    routesByStop.set(touch.stopId, bucket);
  }
  return {
    schemaVersion: 1,
    at: scenario.at,
    states: [...states.values()].map((state) => ({
      ...state,
      routeIds: [...(routesByStop.get(state.stopId) ?? new Set())].sort(),
    })),
  };
}

function windowPayloadFor(scenario) {
  return {
    schemaVersion: 1,
    at: scenario.at,
    windowStart: scenario.windowStart,
    touches: scenario.touches,
    coverage: scenario.coverage,
    patterns: [
      {
        routeId: '506',
        directionId: 0,
        stopIds: [...VOID_CORRIDOR_STOPS, 'st_void_1_w'],
      },
      {
        routeId: '506',
        directionId: 1,
        stopIds: ['st_void_1_w', ...VOID_CORRIDOR_STOPS],
      },
    ],
  };
}

const fakeRecorder = (statesPayload, windowPayload) => ({
  idFromName: () => 'singleton',
  get: () => ({
    fetch: async (url) => {
      const path = String(url);
      if (path.includes('/states')) return Response.json(statesPayload);
      if (path.includes('/window')) return Response.json(windowPayload);
      return new Response(null, { status: 404 });
    },
  }),
});

const envFor = (recorder) => ({ SERVICE_RECORDER: recorder });
const ctx = () => {
  const pending = [];
  return { waitUntil: (promise) => pending.push(promise), pending };
};
const flush = async (context) => Promise.all(context.pending);
const get = async (path, env, headers = {}) => {
  const context = ctx();
  const response = await api.fetch(
    new Request(`https://ttcstatus.ca${path}`, { headers }),
    env,
    context,
  );
  await flush(context);
  return response;
};

// The corpus's one-way void is the canonical end-to-end scenario: a void in
// direction 0, fresh service in direction 1, and honest coverage everywhere.
const oneWay = scenarioById('one-way-void');
const statesPayload = statesPayloadFor(oneWay);
const windowPayload = windowPayloadFor(oneWay);

test('E3S1: /service/stops serves per-direction states with the fleet-endpoint conventions', async () => {
  cacheStore.clear();
  const response = await get(
    '/api/v1/service/stops',
    envFor(fakeRecorder(statesPayload, windowPayload)),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=15');
  assert.equal(response.headers.get('x-live-update-seconds'), '30');
  assert.ok(response.headers.get('x-live-next-update-at'));
  const etag = response.headers.get('etag');
  assert.ok(etag && etag.startsWith('"stops-'));
  const body = await response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.at, oneWay.at);
  const byStop = new Map(body.states.map((state) => [state.stopId, state]));
  // Direction survives end-to-end: void east, fresh west, split by directionId.
  assert.equal(byStop.get('st_void_1').state, 'void');
  assert.equal(byStop.get('st_void_1').directionId, 0);
  assert.equal(byStop.get('st_void_1_w').state, 'fresh');
  assert.equal(byStop.get('st_void_1_w').directionId, 1);
  // Per-stop fields per the contract: both truth axes always present.
  const voided = byStop.get('st_void_2');
  assert.equal(voided.minutesSince, 18.5);
  assert.equal(voided.medianHeadwayOwnSeconds, 345);
  assert.ok(voided.dryness > 3);
  assert.equal(voided.backToBack, 1);
  assert.deepEqual(voided.routeIds, ['506']);
});

test('E3S1: ETag serves 304s within a tick and changes on the next tick', async () => {
  cacheStore.clear();
  const recorder = fakeRecorder(statesPayload, windowPayload);
  const env = envFor(recorder);
  const first = await get('/api/v1/service/stops', env);
  const etag = first.headers.get('etag');
  const sameTick = await get('/api/v1/service/stops', env, { 'if-none-match': etag });
  assert.equal(sameTick.status, 304);
  assert.equal(sameTick.headers.get('etag'), etag);
  // The next tick, after the ~15 s edge cache has expired: the payload
  // watermark moves, the ETag changes, no 304.
  cacheStore.clear();
  const nextTick = { ...statesPayload, at: statesPayload.at + 30_000 };
  const next = await get(
    '/api/v1/service/stops',
    envFor(fakeRecorder(nextTick, windowPayload)),
    {
      'if-none-match': etag,
    },
  );
  assert.equal(next.status, 200);
  assert.notEqual(next.headers.get('etag'), etag);
  assert.equal((await next.json()).at, nextTick.at);
});

test('E3S1: ?routes= filters by route; unknown routes are empty, not errors', async () => {
  cacheStore.clear();
  const env = envFor(fakeRecorder(statesPayload, windowPayload));
  const all = await (await get('/api/v1/service/stops', env)).json();
  assert.ok(all.states.length > 0);
  const filtered = await (await get('/api/v1/service/stops?routes=506', env)).json();
  assert.ok(filtered.states.length > 0);
  assert.ok(filtered.states.every((state) => state.routeIds.includes('506')));
  const none = await (await get('/api/v1/service/stops?routes=999', env)).json();
  assert.equal(none.states.length, 0);
  // Every scenario's routes stay distinct identities (506 vs 306), on their
  // own cache key so the edge cache cannot bleed between filters.
  const nightAndDay = scenarioById('night-and-day');
  const mixed = await get(
    '/api/v1/service/stops?routes=306,506',
    envFor(fakeRecorder(statesPayloadFor(nightAndDay), windowPayload)),
  );
  const body = await mixed.json();
  const routes = new Set(body.states.flatMap((state) => state.routeIds));
  assert.deepEqual([...routes].sort(), ['306', '506']);
});

test('E3S1: unmonitored stops carry their badge and are never rendered void', async () => {
  cacheStore.clear();
  const silent = scenarioById('outage-live');
  const response = await get(
    '/api/v1/service/stops',
    envFor(fakeRecorder(statesPayloadFor(silent), windowPayload)),
  );
  const body = await response.json();
  assert.equal(body.states.length, 1);
  const stop = body.states[0];
  assert.equal(stop.state, 'unmonitored');
  assert.equal(stop.coverage.kind, 'no-reports');
  assert.equal(stop.coverage.unmonitoredSeconds, 1500);
  assert.equal(stop.dryness, null);
});

test('E3S2: /service/wave reconstructs the 30-minute space-time plot in one request', async () => {
  cacheStore.clear();
  const response = await get(
    '/api/v1/service/wave',
    envFor(fakeRecorder(statesPayload, windowPayload)),
  );
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('etag'));
  assert.equal(response.headers.get('cache-control'), 'public, max-age=15');
  const body = await response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.windowStart, oneWay.windowStart);
  assert.equal(body.windowEnd, oneWay.at);
  // Coverage rides along so the field can tell unmonitored from unserviced
  // at any scrub moment (honest replay, §3.6).
  assert.deepEqual(body.coverage, windowPayload.coverage);
  // Two directions, two pattern entries — the split survives.
  assert.equal(body.routes.length, 2);
  const [east] = body.routes;
  assert.equal(east.routeId, '506');
  assert.equal(east.directionId, 0);
  assert.deepEqual(east.patternStopIds, [...VOID_CORRIDOR_STOPS, 'st_void_1_w']);
  assert.ok(east.touches.length > 0);
  // Delta encoding round-trips exactly: windowStart + dt == touch.t.
  const touchTimes = new Set(oneWay.touches.map((touch) => touch.t));
  let reconstructed = 0;
  for (const route of body.routes) {
    for (const touch of route.touches) {
      assert.ok(touch.stopIndex >= 0 && touch.stopIndex < route.patternStopIds.length);
      const absolute = body.windowStart + touch.dt;
      assert.ok(
        touchTimes.has(absolute),
        `reconstructed time ${absolute} not in the window`,
      );
      reconstructed += 1;
    }
  }
  assert.ok(reconstructed >= oneWay.touches.length);
});

test('E3S3: payloads stay within the fleet-endpoint size discipline at ~3k stops', async () => {
  cacheStore.clear();
  const template = statesPayload.states[0];
  const bigStates = Array.from({ length: 3000 }, (_, index) => ({
    ...template,
    stopId: `5_${String(index).padStart(6, '0')}_E`,
    routeIds: ['506'],
  }));
  const response = await get(
    '/api/v1/service/stops',
    envFor(fakeRecorder({ ...statesPayload, states: bigStates }, windowPayload)),
  );
  const bytes = (await response.text()).length;
  assert.ok(bytes > 100_000, 'expected a realistic payload');
  // Worst case (every directional stop active at once — far beyond a real
  // 30-minute window) stays under a megabyte, matching the fleet endpoint's
  // size discipline; wire rounding keeps it there. Real windows serve a few
  // hundred active stops.
  assert.ok(bytes < 1_000_000, `payload too large: ${bytes} bytes`);
});

test('E3S1: an unreachable recorder is an honest 503, never a fabricated payload', async () => {
  cacheStore.clear();
  const broken = {
    idFromName: () => 'singleton',
    get: () => ({
      fetch: async () => {
        throw new Error('DO unreachable');
      },
    }),
  };
  const response = await get('/api/v1/service/stops', envFor(broken));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service-unavailable' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '5');
});
