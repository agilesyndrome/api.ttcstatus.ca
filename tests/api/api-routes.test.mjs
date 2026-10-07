import assert from 'node:assert/strict';
import { compileModules } from '../helpers/compile.mjs';
import test from 'node:test';
const { api, generator, requestMapGeneration } = await compileModules(`
  export { default as api } from './workers/api/src/index';
  export { default as generator } from './workers/map-generator/src/index';
  export { requestMapGeneration } from './workers/api/src/sync/network-lifecycle';`);
const ctx = { waitUntil() {} };
const db = {
  prepare() {
    return {
      first: async () => null,
      all: async () => ({ results: [] }),
      bind() {
        return this;
      },
      run: async () => ({}),
    };
  },
};

test('public API uses /api for health, map, network, feed and protected operations', async () => {
  const env = { DB: db };
  for (const [path, method, status, error] of [
    ['/api/healthz', 'GET', 200],
    ['/api/healthz', 'HEAD', 200],
    ['/api/v1/map/streetcar', 'GET', 503, 'map-not-ready'],
    ['/api/v1/network', 'GET', 503, 'network-not-ready'],
    ['/api/v1/feed/status', 'GET', 404, 'feed-status-disabled'],
    ['/api/v1/admin/sync', 'POST', 404, 'manual-sync-disabled'],
    ['/api/v1/debug/map/streetcar.svg', 'POST', 404, 'debug-render-disabled'],
  ]) {
    const response = await api.fetch(
      new Request(`https://example.test${path}`, { method }),
      env,
      ctx,
    );
    assert.equal(response.status, status, path);
    if (error) assert.equal((await response.json()).error, error);
  }
  for (const path of ['/healthz', '/v1/map/streetcar', '/v1/vehicles/streetcar']) {
    assert.equal(
      (await api.fetch(new Request(`https://example.test${path}`), env, ctx)).status,
      404,
    );
  }
  assert.equal(
    (await api.fetch(new Request('https://example.test/api/unknown'), env, ctx)).status,
    404,
  );
});

test('protected routes keep authorization and service calls use the migrated paths', async () => {
  assert.equal(
    (
      await api.fetch(
        new Request('https://example.test/api/v1/admin/sync', { method: 'POST' }),
        { SYNC_TOKEN: 'test' },
        ctx,
      )
    ).status,
    401,
  );
  // Feed status is admin-gated diagnostics: no token configured -> disabled,
  // wrong token -> unauthorized, correct token -> payload.
  assert.equal(
    (
      await api.fetch(
        new Request('https://example.test/api/v1/feed/status'),
        { DB: db },
        ctx,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api.fetch(
        new Request('https://example.test/api/v1/feed/status'),
        { DB: db, SYNC_TOKEN: 'test' },
        ctx,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await api.fetch(
        new Request('https://example.test/api/v1/feed/status', {
          headers: { authorization: 'Bearer test' },
        }),
        { DB: db, SYNC_TOKEN: 'test' },
        ctx,
      )
    ).status,
    200,
  );
  let requested;
  const env = {
    SYNC_TOKEN: 'test',
    MAP_GENERATOR: {
      fetch: async (url, init) => {
        requested = { url, init };
        return new Response('<svg/>');
      },
    },
  };
  const response = await api.fetch(
    new Request('https://example.test/api/v1/debug/map/streetcar.svg', {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: '{}',
    }),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(requested.url, 'https://map-generator.internal/api/debug/render');
  assert.equal(requested.init.headers.authorization, 'Bearer test');
  const id = await requestMapGeneration(
    {
      DB: db,
      SYNC_TOKEN: 'test',
      MAP_GENERATOR: {
        fetch: async (url, init) => {
          requested = url;
          assert.equal(init.headers.authorization, 'Bearer test');
          return Response.json({ artifactId: 42 });
        },
      },
    },
    7,
  );
  assert.equal(id, 42);
  assert.equal(requested, 'https://map-generator.internal/api/internal/generate');
  assert.equal(
    (await generator.fetch(new Request('https://example.test/api/healthz'), {}, ctx))
      .status,
    200,
  );
  assert.equal(
    (
      await generator.fetch(
        new Request('https://example.test/api/debug/render', { method: 'POST' }),
        {},
        ctx,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await generator.fetch(
        new Request('https://example.test/api/internal/generate', {
          method: 'POST',
          headers: { authorization: 'Bearer test' },
          body: '{}',
        }),
        { SYNC_TOKEN: 'test' },
        ctx,
      )
    ).status,
    400,
  );
});

test('manual sync runs the pipeline inline and reports the real outcome', async () => {
  const url = 'https://example.test/api/v1/admin/sync';
  const request = (database) =>
    api.fetch(
      new Request(url, {
        method: 'POST',
        headers: { authorization: 'Bearer test' },
      }),
      {
        SYNC_TOKEN: 'test',
        DB: database,
        STATIC_GTFS_URL: 'https://feed.test/static.zip',
        SOURCE_ATTRIBUTION: 'test',
        GTFS_BUCKET: {},
        MAP_GENERATOR: { fetch: async () => new Response('{}') },
      },
      ctx,
    );
  // A broken environment surfaces the actual pipeline error instead of an
  // unconditional background "accepted": the sync completes within the request.
  const failing = await request(db);
  assert.equal(failing.status, 500);
  assert.match((await failing.json()).error, /Unable to initialize source state/);
  // A held lock answers busy synchronously rather than deferring the work.
  const locked = {
    prepare() {
      return {
        bind() {
          return this;
        },
        first: async () => ({ source_key: 'ttc-surface-gtfs' }),
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      };
    },
  };
  const busy = await request(locked);
  assert.equal(busy.status, 200);
  assert.equal((await busy.json()).reason, 'sync-already-running');
  assert.equal(busy.headers.get('cache-control'), 'no-store');
});

test('map GET and HEAD accept compressed weak ETags and validator lists', async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          first: async () => ({ etag: 'map-v1', version_id: 7 }),
        };
      },
    },
  };
  for (const method of ['GET', 'HEAD']) {
    for (const validator of ['W/"map-v1"', '"older", W/"map-v1"', '*']) {
      const response = await api.fetch(
        new Request(`https://example.test/api/v1/map/streetcar`, {
          method,
          headers: { 'if-none-match': validator },
        }),
        env,
        ctx,
      );
      assert.equal(response.status, 304);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('etag'), '"map-v1"');
      assert.equal(response.headers.get('x-network-version'), '7');
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
    }
  }
  // A wildcard must not turn an absent map into a successful cache validation.
  const missing = await api.fetch(
    new Request(`https://example.test/api/v1/map/streetcar`, {
      headers: { 'if-none-match': '*' },
    }),
    { DB: db },
    ctx,
  );
  assert.equal(missing.status, 503);
});

test('every published map name serves through the same contract', async () => {
  // The snake board is a named artifact like the schematic, not a client hack.
  for (const name of ['streetcar', 'snake']) {
    const response = await api.fetch(
      new Request(`https://example.test/api/v1/map/${name}`),
      { DB: db },
      ctx,
    );
    assert.equal(response.status, 503, name);
    assert.equal((await response.json()).error, 'map-not-ready');
  }
});
