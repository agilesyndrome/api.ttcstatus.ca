import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createDatabase } from '../helpers/database.mjs';
import { compileModules } from '../helpers/compile.mjs';
import { edgeCacheStore } from '../helpers/edge-cache.mjs';

// The delivered-service access model after docs/optimize-overlay.md Epic 3:
// the stops route is DELETED (its payload is public broadcast data from the
// CDN-published live tick documents — the no-fallback doctrine, like the
// vehicle route before it); history is public broadcast data, edge-cached by
// full URL; wave stays the members-only replay — a locally verified session,
// no per-user grant (the `voidOverlay` flag is gone from the wire). The
// recorder is faked as a stub namespace serving the corpus window — exactly
// the layer contract the DO implements.
const { api, scenarioById, VOID_CORRIDOR_STOPS } = await compileModules(`
  export { default as api } from './workers/api/src/index';
  export * from './shared/service/fixtures';
`);

// ---- Session fixture: a real RSA pair plays Clerk's JWKS (wave's gate) ----
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const fixtureJwks = {
  keys: [{ kty: 'RSA', kid: 'test-key', n: publicJwk.n, e: publicJwk.e }],
};
const jwksUrl = `data:application/json,${encodeURIComponent(JSON.stringify(fixtureJwks))}`;
const b64url = (buffer) =>
  Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const sessionToken = (sub = 'user_member', expSeconds = 3600) => {
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
// The flags schema still exists in the fixture env — its presence with ZERO
// grant rows is itself the assertion: nothing on the service surface consults
// a per-user flag anymore.
const flagsSchema = await readFile('migrations/0005_feature_flags.sql', 'utf8');

// A Map-backed edge cache shared across the suite's process (see
// tests/helpers/edge-cache.mjs); tests clear it when they assert on caching.
const cacheStore = edgeCacheStore;

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

const fakeRecorder = (windowPayload) => ({
  idFromName: () => 'singleton',
  get: () => ({
    fetch: async (url) => {
      const path = String(url);
      // No /states branch: the recorder is write-only for states
      // (optimize-overlay.md E3S3) — nothing may fetch them, not even a stub.
      if (path.includes('/window')) return Response.json(windowPayload);
      return new Response(null, { status: 404 });
    },
  }),
});

/** The env: fixture flags DB (empty — no grant rows, proving no flag
 * lookup), local-verification JWKS URL, stub recorder. */
const envFor = (recorder) => ({
  DB: createDatabase(flagsSchema),
  CLERK_JWKS_URL: jwksUrl,
  SERVICE_RECORDER: recorder,
});

const ctx = () => {
  const pending = [];
  return { waitUntil: (promise) => pending.push(promise), pending };
};
const flush = async (context) => Promise.all(context.pending);
/** Authed by default with the fixture session (wave's members gate);
 * `auth: false` drops the Bearer, `token` overrides it. Extra headers merge. */
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
const windowPayload = windowPayloadFor(oneWay);

test('E3S2: /service/wave reconstructs the 30-minute space-time plot in one request', async () => {
  cacheStore.clear();
  const response = await get('/api/v1/service/wave', envFor(fakeRecorder(windowPayload)));
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('etag'));
  // Members-only surface (the E4S5 decision): private, never a shared cache.
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

test('E3S4: the wave memo serves the same-tick 304 without recomputing', async () => {
  cacheStore.clear();
  const env = envFor(fakeRecorder(windowPayload));
  const etag = (await get('/api/v1/service/wave', env)).headers.get('etag');
  // Same tick (the fixture payload is tick-stable): the memoized bytes answer
  // behind the session gate — a 304, no serialize, no hash.
  const again = await get('/api/v1/service/wave', env, { 'if-none-match': etag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get('etag'), etag);
  // Authorized data never enters a shared cache (members-only, E4S5).
  assert.equal(cacheStore.size, 0, 'no wave response may be cached at the edge');
});

test('E3S3: the stops route is deleted, not flagged — 404 even with a recorder', async () => {
  const env = envFor(fakeRecorder(windowPayload));
  assert.equal((await get('/api/v1/service/stops', env)).status, 404);
  // The selector allowlist entry died with the route: `?routes=` is now an
  // unsupported query on a public path (the privacy boundary rejects it
  // before routing), so it can never become a per-user URL shape again.
  assert.equal((await get('/api/v1/service/stops?routes=506', env)).status, 400);
});

test('an unreachable recorder is an honest 503, never a fabricated payload', async () => {
  cacheStore.clear();
  const broken = {
    idFromName: () => 'singleton',
    get: () => ({
      fetch: async () => {
        throw new Error('DO unreachable');
      },
    }),
  };
  const response = await get('/api/v1/service/wave', envFor(broken));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service-unavailable' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '5');
});

test('E3S1: history is public broadcast data — no session, edge-cached by full URL', async () => {
  cacheStore.clear();
  const rollupsSchema = await readFile('migrations/0006_service_rollups.sql', 'utf8');
  const env = envFor(fakeRecorder(windowPayload));
  env.DB = createDatabase(rollupsSchema);
  const bucket = Math.floor(Date.now() / 300_000) * 300_000;
  await env.DB.prepare(
    `INSERT INTO service_rollups (stop_id, bucket_start, n, headway_sum, headway_sum_sq,
         max_gap_seconds, first_touch_at, last_touch_at, back_to_back, distinct_vehicles,
         route_ids, coverage_bits, fold_hash)
       VALUES ('st_hist', ?, 3, 900, 270000, 300, ?, ?, 0, 1, '["506"]', 1023, 'fixturehash')`,
  )
    .bind(bucket, bucket, bucket + 120_000)
    .run();
  // No session at all — the stop card's details are for every visitor.
  const first = await get(
    '/api/v1/service/history?stop=st_hist',
    env,
    {},
    { auth: false },
  );
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('access-control-allow-origin'), '*');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(first.headers.get('x-ttcstatus-cache'), 'MISS');
  const etag = first.headers.get('etag');
  const body = await first.json();
  assert.equal(body.summaries.length, 1);
  assert.equal(body.summaries[0].stopId, 'st_hist');
  assert.equal(body.summaries[0].n, 3);
  assert.deepEqual(body.summaries[0].routeIds, ['506']);
  // E3S4: the window edges are quantized to the 5-minute fold grid — the
  // payload is fold-stable, so ETags hold between folds.
  assert.equal(body.to % 300_000, 0);
  assert.equal(body.from % 300_000, 0);
  // The narrowing-filter requirement stays: queries without one are bounded
  // out with an honest 400, session or not.
  assert.equal(
    (await get('/api/v1/service/history', env, {}, { auth: false })).status,
    400,
  );
  // The second identical question is an edge HIT — no D1 read at all.
  const second = await get(
    '/api/v1/service/history?stop=st_hist',
    env,
    {},
    { auth: false },
  );
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-ttcstatus-cache'), 'HIT');
  assert.equal(second.headers.get('etag'), etag);
  assert.deepEqual(await second.json(), body);
});

test('E3S2: wave keeps the verified-session gate — 401 anonymous, 200 for any member', async () => {
  cacheStore.clear();
  const env = envFor(fakeRecorder(windowPayload));
  // The env's flags table has ZERO grant rows — a 200 here is the proof that
  // no per-user grant participates anymore (identity from the token only).
  const anonymous = await get('/api/v1/service/wave', env, {}, { auth: false });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });
  // A tampered token is rejected by real verification, not a pattern match.
  const tampered = await get('/api/v1/service/wave', env, {
    authorization: `Bearer ${sessionToken().replace(/.$/, '!')}`,
  });
  assert.equal(tampered.status, 401);
  const member = await get('/api/v1/service/wave', env);
  assert.equal(member.status, 200);
});
