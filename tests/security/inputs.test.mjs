import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';
import { readFile } from 'node:fs/promises';

const {
  renderDebugMapSvg,
  generator,
  api,
  readLimitedBytes,
  BodyTooLargeError,
  csvRows,
} = await compileModules(`
  export { renderDebugMapSvg } from './workers/map-generator/src/rendering/debug-render';
  export { default as generator } from './workers/map-generator/src/index';
  export { default as api } from './workers/api/src/index';
  export { readLimitedBytes, BodyTooLargeError } from './workers/shared/http/streams';
  export { csvRows } from './workers/shared/gtfs/csv';
`);
const seed = () => ({
  display: { width: 1600, height: 1100 },
  routes: [],
  stops: [],
  graph: { nodes: [], edges: [] },
  context: { labels: [], shoreline: [], north: { angle: -90 } },
});
const injection = '0)"><script>alert(1)</script><g transform="rotate(0';

test('debug SVG rejects attribute injection through every unescaped numeric field', () => {
  const mutations = [
    (map) => {
      map.context.north.angle = injection;
    },
    (map) => {
      map.context.labels.push({
        text: 'Label',
        kind: 'street',
        angle: injection,
        point: [0, 0],
      });
    },
    (map) => {
      map.context.labels.push({
        text: 'Label',
        kind: 'terminal',
        angle: 0,
        point: [injection, 0],
      });
    },
    (map) => {
      map.graph.nodes.push({
        id: 'junction',
        x: injection,
        y: 0,
        edgeIds: ['a', 'b', 'c'],
      });
    },
    (map) => {
      map.context.shoreline.push([0, injection]);
    },
    (map) => {
      map.display.width = injection;
    },
  ];
  for (const mutate of mutations) {
    const map = seed();
    mutate(map);
    assert.throws(() => renderDebugMapSvg(map));
  }
});

test('debug SVG retains valid production rendering and escapes labels as text', async () => {
  const production = JSON.parse(
    await readFile('data/fixtures/streetcar-schematic.json', 'utf8'),
  );
  assert.ok(renderDebugMapSvg(production).startsWith('<?xml'));
  const map = seed();
  map.context.labels.push({
    text: '<script>&"',
    kind: 'street',
    angle: 0,
    point: [600, 400],
  });
  const svg = renderDebugMapSvg(map);
  assert.ok(svg.includes('&lt;script&gt;&amp;&quot;'));
  assert.ok(!svg.includes('<script>'));
});

test('streamed byte limits cancel oversized input without trusting Content-Length', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
      controller.enqueue(new Uint8Array(6));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readLimitedBytes(stream, 10), BodyTooLargeError);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
  const exact = new Response('0123456789').body;
  assert.equal((await readLimitedBytes(exact, 10)).byteLength, 10);
});

test('debug endpoints bound input before buffering or forwarding it', async () => {
  const request = (path) =>
    new Request(`https://example.test${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
      body: new Uint8Array(2_000_001),
    });
  const env = {
    SYNC_TOKEN: 'test',
    MAP_GENERATOR: {
      fetch() {
        throw new Error('Oversized bodies must not be forwarded');
      },
    },
  };
  assert.equal(
    (await api.fetch(request('/api/v1/debug/map/streetcar.svg'), env, {})).status,
    413,
  );
  assert.equal(
    (await generator.fetch(request('/api/debug/render'), env, {})).status,
    413,
  );
  const valid = new Request('https://example.test/api/debug/render', {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    body: JSON.stringify(seed()),
  });
  const response = await generator.fetch(valid, env, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('CSV parsing preserves quoted data across byte boundaries and releases cancelled input', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const text of ['id,note\r\n1,"a', '""b\n', 'c"\r\n'])
        controller.enqueue(encoder.encode(text));
    },
    cancel() {
      cancelled = true;
    },
  });
  for await (const row of csvRows(stream)) {
    assert.deepEqual(row, { id: '1', note: 'a"b\nc' });
    break;
  }
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('CSV parsing rejects oversized fields and rows instead of retaining unbounded strings', async () => {
  async function consume(text) {
    for await (const _row of csvRows(new Response(text).body)) {
      /* Consume validation input. */
    }
  }
  await assert.rejects(consume('id\n' + 'x'.repeat(1_048_578)), /too large/);
  await assert.rejects(
    consume(Array(1001).fill('column').join(',') + '\n'),
    /too many columns/,
  );
});
