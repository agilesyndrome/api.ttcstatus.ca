import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: 'export * from "./workers/api/src/lite/response";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const { renderLitePage, rankStops, liteResponse } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

const state = (stopId, overrides = {}) => ({
  stopId,
  directionId: 0,
  state: 'due',
  lastTouchAt: 1_800_000_000_000,
  minutesSince: 12,
  medianHeadwayOwnSeconds: 360,
  irregularity: 0.2,
  expectedWaitSeconds: 480,
  dryness: 2,
  backToBack: 0,
  routeIds: ['501'],
  coverage: { kind: 'observable', unmonitoredSeconds: 0, since: null },
  ...overrides,
});
const tick = (states, overrides = {}) => ({
  schemaVersion: 1,
  at: 1_800_000_000_000,
  tickId: 42,
  states,
  ...overrides,
});

test('lite renderer stays ASCII and its preformatted board stays within 79 columns', () => {
  const html = renderLitePage(
    '/lite',
    tick([state('1485'), state('1501', { state: 'fresh', dryness: 0.4 })]),
  );
  for (const byte of Buffer.from(html))
    assert.ok(byte === 10 || (byte >= 0x20 && byte <= 0x7e), `non-ASCII byte ${byte}`);
  const pre = html.match(/<pre>([\s\S]*)<\/pre>/)[1].replaceAll(/<[^>]+>/g, '');
  for (const row of pre.split('\n')) assert.ok(row.length <= 79, `line too wide: ${row}`);
  assert.match(html, /<form action="\/lite" method="get">/);
  assert.match(html, /<a href="\/lite\/stop\/1485">\/lite\/stop\/1485<\/a>/);
});

test('ranking excludes fresh, collecting, and unmonitored rows and breaks ties honestly', () => {
  const ranked = rankStops([
    state('fresh', { state: 'fresh', dryness: 9 }),
    state('blind', { state: 'unmonitored', dryness: null }),
    state('thin', { state: 'collecting', dryness: 8 }),
    state('due-a', { dryness: 2, irregularity: 0.4 }),
    state('void-a', { state: 'void', dryness: 2, irregularity: 0.1 }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.stopId),
    ['void-a', 'due-a'],
  );
});

test('outage ticks render the honest blank and never a ranking', () => {
  const html = renderLitePage(
    '/lite',
    tick([], { outage: { since: '2026-10-14T12:00:00.000Z', tickId: 42 } }),
  );
  assert.match(html, /FIELD UNAVAILABLE SINCE/);
  assert.doesNotMatch(html, /WORST STOPS/);
});

test('local worker without an R2 tick still serves the BBS shell', async () => {
  const response = await liteResponse(
    new Request('http://127.0.0.1:8787/lite/'),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /FIELD UNAVAILABLE/);
});

test('closures require every watched stop on an arm to be old void', () => {
  const old = 1_800_000_000_000 - 31 * 60_000;
  const html = renderLitePage(
    '/lite/closures',
    tick([
      state('void-a', { state: 'void', lastTouchAt: old }),
      state('void-b', { state: 'void', lastTouchAt: old }),
      state('due-c', { state: 'due', lastTouchAt: old }),
    ]),
  );
  assert.doesNotMatch(html, /no car observed/);
  const closed = renderLitePage(
    '/lite/closures',
    tick([
      state('void-a', { state: 'void', lastTouchAt: old }),
      state('void-b', { state: 'void', lastTouchAt: old }),
    ]),
  );
  assert.match(closed, /no car observed/);
});

test('dig pages expose route letters and at most five stop choices', () => {
  const names = new Map(
    Array.from({ length: 6 }, (_, index) => [
      String(index + 1),
      `QUEEN ST W AT J${index + 1} ST`,
    ]),
  );
  const html = renderLitePage(
    '/lite/r/501/J',
    tick([state('1'), state('2'), state('3'), state('4'), state('5'), state('6')]),
    names,
  );
  assert.match(html, /cross streets starting with J/);
  assert.equal((html.match(/\[(?:1|2|3|4|5)\]/g) ?? []).length, 5);
});
