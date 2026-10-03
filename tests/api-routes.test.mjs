import assert from 'node:assert/strict';
import { build } from 'esbuild';
import test from 'node:test';
const compiled = await build({ stdin: { contents: `
  export { default as api } from './workers/api/src/index';
  export { default as generator } from './workers/map-generator/src/index';
  export { requestMapGeneration } from './workers/api/src/network-lifecycle';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir('.wrangler/tests', { recursive: true });
await writeFile('.wrangler/tests/routes.mjs', compiled.outputFiles[0].text);
const { api, generator, requestMapGeneration } = await import('../.wrangler/tests/routes.mjs');
const ctx = { waitUntil() {} };
const db = { prepare() { return { first: async () => null, all: async () => ({ results: [] }), bind() { return this; }, run: async () => ({}) }; } };

test('public API uses /api for health, map, network, feed and protected operations', async () => {
  const env = { DB: db };
  for (const [path, method, status, error] of [
    ['/api/healthz', 'GET', 200], ['/api/healthz', 'HEAD', 200],
    ['/api/v1/map/streetcar', 'GET', 503, 'map-not-ready'],
    ['/api/v1/network', 'GET', 503, 'network-not-ready'],
    ['/api/v1/feed/status', 'GET', 200],
    ['/api/v1/admin/sync', 'POST', 404, 'manual-sync-disabled'],
    ['/api/v1/debug/map/streetcar.svg', 'POST', 404, 'debug-render-disabled'],
  ]) {
    const response = await api.fetch(new Request(`https://example.test${path}`, { method }), env, ctx);
    assert.equal(response.status, status, path);
    if (error) assert.equal((await response.json()).error, error);
  }
  for (const path of ['/healthz', '/v1/map/streetcar', '/v1/vehicles/streetcar']) {
    assert.equal((await api.fetch(new Request(`https://example.test${path}`), env, ctx)).status, 404);
  }
  assert.equal((await api.fetch(new Request('https://example.test/api/unknown'), env, ctx)).status, 404);
});

test('protected routes keep authorization and service calls use the migrated paths', async () => {
  assert.equal((await api.fetch(new Request('https://example.test/api/v1/admin/sync', { method: 'POST' }), { SYNC_TOKEN: 'test' }, ctx)).status, 401);
  let requested;
  const env = { SYNC_TOKEN: 'test', MAP_GENERATOR: { fetch: async (url, init) => { requested = { url, init }; return new Response('<svg/>'); } } };
  const response = await api.fetch(new Request('https://example.test/api/v1/debug/map/streetcar.svg', { method: 'POST', headers: { authorization: 'Bearer test' }, body: '{}' }), env, ctx);
  assert.equal(response.status, 200); assert.equal(requested.url, 'https://map-generator.internal/api/debug/render');
  assert.equal(requested.init.headers.authorization, 'Bearer test');
  const id = await requestMapGeneration({ DB: db, MAP_GENERATOR: { fetch: async (url) => { requested = url; return Response.json({ artifactId: 42 }); } } }, 7);
  assert.equal(id, 42); assert.equal(requested, 'https://map-generator.internal/api/internal/generate');
  assert.equal((await generator.fetch(new Request('https://example.test/api/healthz'), {}, ctx)).status, 200);
  assert.equal((await generator.fetch(new Request('https://example.test/api/debug/render', { method: 'POST' }), {}, ctx)).status, 404);
  assert.equal((await generator.fetch(new Request('https://example.test/api/internal/generate', { method: 'POST', body: '{}' }), {}, ctx)).status, 400);
});
