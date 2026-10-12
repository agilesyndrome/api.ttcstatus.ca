import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createDatabase } from '../helpers/database.mjs';
import { compileModules } from '../helpers/compile.mjs';

// Epic 3 boundary (stories E3S1–E3S3): the service endpoints through the real
// router, with the recorder singleton faked as a stub namespace serving
// corpus-derived payloads — exactly the layer contract the DO implements.
// Epic 4 (E4S2): the endpoints are grant-gated, so every call carries a
// locally verified fixture session (real RSA key pair; the JWKS rides a
// data: URL so no global fetch mock is needed) and a `voidOverlay` flag row.
const { api, scenarioById, serviceStatesAt, serviceConfig, VOID_CORRIDOR_STOPS } =
  await compileModules(`
  export { default as api } from './workers/api/src/index';
  export * from './shared/service/fixtures';
  export { serviceStatesAt } from './shared/service/wait-metrics';
  export { serviceConfig } from './shared/service/config';
`);

const config = serviceConfig();

// ---- Grant-gate fixture: a real RSA pair plays Clerk's JWKS ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const fixtureJwks = {
  keys: [{ kty: 'RSA', kid: 'test-key', n: publicJwk.n, e: publicJwk.e }],
};
const jwksUrl = `data:application/json,${encodeURIComponent(JSON.stringify(fixtureJwks))}`;
const b64url = (buffer) =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sessionToken = (sub = 'user_overlay', expSeconds = 3600) => {
  const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
  const claims = {
    sub,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
    iss: 'https://clerk-fixture.test',
    azp: 'https://ttcstatus.ca',
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${input}.${b64url(createSign('RSA-SHA256').update(input).sign(privateKey))}`;
};
const flagsSchema = await readFile('migrations/0005_feature_flags.sql', 'utf8');
const grantedDb = async () => {
  const db = createDatabase(flagsSchema);
  await db
    .prepare('INSERT INTO feature_flags (subject, flag) VALUES (?, ?)')
    .bind('user_overlay', 'voidOverlay')
    .run();
  return db;
};

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

/** Grant-gated env (E4S2): fixture flags DB (with the `voidOverlay` grant
 * unless `grant: false`), local-verification JWKS URL, stub recorder. The
 * flag insert runs synchronously under node:sqlite, so it is visible to the
 * request without awaiting the wrapper promise. */
const envFor = (recorder, { grant = true } = {}) => {
  const db = createDatabase(flagsSchema);
  if (grant)
    void db
      .prepare(
        'INSERT INTO feature_flags (subject, flag, granted_at, granted_by) VALUES (?, ?, ?, ?)',
      )
      .bind('user_overlay', 'voidOverlay', 0, 'fixture')
      .run();
  return { DB: db, CLERK_JWKS_URL: jwksUrl, SERVICE_RECORDER: recorder };
};
const ctx = () => {
  const pending = [];
  return { waitUntil: (promise) => pending.push(promise), pending };
};
const flush = async (context) => Promise.all(context.pending);
/** Authed by default with the granted fixture session (E4S2); `auth: false`
 * drops the Bearer, `token` overrides it. Extra headers merge over. */
const get = async (path, env, headers = {}, { auth = true, token } = {}) => {
  const context = ctx();
  const response = await api.fetch(
    new Request(`https://ttcstatus.ca${path}`, {
      headers: auth
        ? { authorization: `Bearer ${token ?? sessionToken()}`, ...headers }
        : headers,
    }),
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
  // Authorized data (E4S2): private, never a shared cache.
  assert.equal(response.headers.get('cache-control'), 'private, max-age=15');
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
  // Authorized data (E4S2): private, never a shared cache.
  assert.equal(response.headers.get('cache-control'), 'private, max-age=15');
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

test('E4S2: service data is grant-gated — 401 without a session, 403 without the voidOverlay grant', async () => {
  const recorder = fakeRecorder(statesPayload, windowPayload);
  const granted = envFor(recorder);
  const ungranted = envFor(recorder, { grant: false });
  // No session at all: 401, no-store, and the recorder is never touched.
  const anonymous = await get('/api/v1/service/stops', granted, {}, { auth: false });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });
  // A tampered token is rejected by real verification, not a pattern match.
  const tampered = await get('/api/v1/service/stops', granted, {
    authorization: `Bearer ${sessionToken().replace(/.$/, '!')}`,
  });
  assert.equal(tampered.status, 401);
  // A valid session without the grant: 403, honest, no data.
  const forbidden = await get('/api/v1/service/stops', ungranted);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: 'forbidden' });
  // The same gate covers the whole service family. History reads the
  // rollups table, so give the granted env that schema too.
  const rollupsSchema = await readFile('migrations/0006_service_rollups.sql', 'utf8');
  const historyEnv = envFor(recorder);
  historyEnv.DB = createDatabase(flagsSchema + '\n' + rollupsSchema);
  void historyEnv.DB
    .prepare(
      'INSERT INTO feature_flags (subject, flag, granted_at, granted_by) VALUES (?, ?, ?, ?)',
    )
    .bind('user_overlay', 'voidOverlay', 0, 'fixture')
    .run();
  for (const path of ['/api/v1/service/wave', '/api/v1/service/history?stop=st_void_1']) {
    assert.equal((await get(path, ungranted)).status, 403, `${path} must be gated`);
    assert.equal((await get(path, historyEnv)).status, 200, `${path} serves granted callers`);
  }
  // Authorized data never enters a shared cache (E4S2's privacy rule).
  assert.equal(cacheStore.size, 0, 'no service response may be cached at the edge');
});
