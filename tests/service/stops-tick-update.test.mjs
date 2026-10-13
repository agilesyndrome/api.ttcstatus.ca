import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// E2S1 (docs/optimize-overlay.md): the stops tick contract — the exact
// three-case seam the fleet transport uses, pointed at the overlay's tick
// path. Same harness style as tests/live/live-updates.test.mjs.

const compiled = await build({
  stdin: {
    contents: `
  export * from "./shared/live/polling";`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const { requestStopsTickUpdate, liveTickUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

// The overlay launch composes a fleet-shaped transport: live host + overlay
// path + overlay poll cadence.
const transport = {
  base: 'https://live.ttcstatus.ca',
  pathTemplate: '/live/t/{tick}/service-stops.json',
  updateSeconds: 30,
};

const doc = (states, at, extra = {}) =>
  new Response(
    JSON.stringify({ schemaVersion: 1, at, tickId: at / 30_000, states, ...extra }),
    {
      status: 200,
      headers: { etag: `"stops-${at}"` },
    },
  );

const state = (stopId) => ({
  stopId,
  directionId: 1,
  state: 'void',
  lastTouchAt: 0,
  minutesSince: 21,
  medianHeadwayOwnSeconds: 300,
  irregularity: 0.2,
  expectedWaitSeconds: 400,
  dryness: 4.2,
  backToBack: 0,
  routeIds: ['506'],
  coverage: null,
});

test('E2S1: a 200 document delivers states, the tick watermark, and the ETag', async () => {
  const calls = [];
  const result = await requestStopsTickUpdate(
    transport,
    new AbortController().signal,
    undefined,
    (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(doc([state('st_a')], 1_800_000_000_000));
    },
    () => 1_800_000_000_000, // a tick-aligned now
  );
  // The URL is derived from config: overlay path on the live host, tick from
  // the shared grid — never a query string, never a Worker route.
  assert.equal(
    calls[0].url,
    'https://live.ttcstatus.ca/live/t/60000000/service-stops.json',
  );
  assert.equal(calls[0].init.cache, 'no-store');
  assert.deepEqual(
    result.states.map((entry) => entry.stopId),
    ['st_a'],
  );
  assert.equal(result.at, 1_800_000_000_000);
  assert.equal(result.etag, '"stops-1800000000000"');
  assert.equal(result.updateSeconds, 30);
  assert.equal(result.outage, undefined);
  assert.equal(result.unpublished, undefined);
});

test('E2S1: a 404 retries the previous tick once and accepts its document', async () => {
  const urls = [];
  const result = await requestStopsTickUpdate(
    transport,
    new AbortController().signal,
    undefined,
    (url) => {
      urls.push(url);
      return Promise.resolve(
        url.endsWith('/60000000/service-stops.json')
          ? new Response('not found', { status: 404 })
          : doc([state('st_prev')], 1_799_999_970_000),
      );
    },
    () => 1_800_000_000_000,
  );
  assert.deepEqual(urls, [
    'https://live.ttcstatus.ca/live/t/60000000/service-stops.json',
    'https://live.ttcstatus.ca/live/t/59999999/service-stops.json',
  ]);
  assert.equal(result.at, 1_799_999_970_000);
  assert.deepEqual(
    result.states.map((entry) => entry.stopId),
    ['st_prev'],
  );
});

test('E2S1: 404 → 404 is unpublished — a no-op, never a failure', async () => {
  const result = await requestStopsTickUpdate(
    transport,
    new AbortController().signal,
    undefined,
    () => Promise.resolve(new Response('not found', { status: 404 })),
    () => 1_800_000_000_000,
  );
  assert.equal(result.unpublished, true);
  assert.equal(result.states, undefined);
  assert.equal(result.updateSeconds, 30);
});

test('E2S1: a 304 keeps the retained ETag and carries no states', async () => {
  const result = await requestStopsTickUpdate(
    transport,
    new AbortController().signal,
    '"stops-prev"',
    () =>
      Promise.resolve(
        new Response(null, { status: 304, headers: { etag: '"stops-prev"' } }),
      ),
    () => 1_800_000_000_000,
  );
  assert.equal(result.states, undefined);
  assert.equal(result.etag, '"stops-prev"');
});

test('E2S1: an outage doc is a document — empty states flagged, never a failure', async () => {
  const result = await requestStopsTickUpdate(
    transport,
    new AbortController().signal,
    undefined,
    () =>
      Promise.resolve(
        doc([], 1_800_000_000_000, {
          outage: {
            since: new Date(1_800_000_000_000).toISOString(),
            tickId: 60_000_000,
          },
        }),
      ),
    () => 1_800_000_000_000,
  );
  assert.deepEqual(result.states, []);
  assert.equal(result.outage, true);
  assert.equal(result.at, 1_800_000_000_000);
});

test('E2S1: anything else is a network failure — the caller owns the backoff', async () => {
  await assert.rejects(
    requestStopsTickUpdate(
      transport,
      new AbortController().signal,
      undefined,
      () => Promise.resolve(new Response('boom', { status: 503 })),
      () => 1_800_000_000_000,
    ),
    /HTTP 503/,
  );
  // No 5xx/Retry-After parsing exists: the error is opaque to the caller.
  await assert.rejects(
    requestStopsTickUpdate(
      transport,
      new AbortController().signal,
      undefined,
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ schemaVersion: 1, at: 1, tickId: 0 }), {
            status: 200,
          }),
        ),
      () => 1_800_000_000_000,
    ),
    /Invalid live stops document/,
  );
});

test('E2S1: liveTickUrl composes the overlay path from config alone', () => {
  assert.equal(
    liveTickUrl(transport, 60_000_000),
    'https://live.ttcstatus.ca/live/t/60000000/service-stops.json',
  );
  // Same-origin base (local preview) composes the same way.
  assert.equal(
    liveTickUrl({ ...transport, base: '' }, 5),
    '/live/t/5/service-stops.json',
  );
});
