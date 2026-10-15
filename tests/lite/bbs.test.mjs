import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createDatabase } from '../helpers/database.mjs';

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

test('dig pages expose stop-name initials and all matching stop choices', () => {
  const names = new Map(
    Array.from({ length: 6 }, (_, index) => [
      String(index + 1),
      `QUEEN ST W AT J${index + 1} ST`,
    ]),
  );
  const html = renderLitePage(
    '/lite/r/501/Q',
    tick([state('1'), state('2'), state('3'), state('4'), state('5'), state('6')]),
    names,
  );
  assert.match(html, /stop or cross-street names matching Q/);
  assert.equal((html.match(/\[(?:1|2|3|4|5|6)\]/g) ?? []).length, 6);
  assert.match(html, /QUEEN ST W AT J6 ST/);
});

test('dig indexes AT stops under both street initials and stop details collapse paired records', () => {
  const names = new Map([
    ['809', 'COLLEGE ST AT AUGUSTA AV'],
    ['12338', 'COLLEGE ST AT AUGUSTA AV'],
  ]);
  const states = [
    state('809', { routeIds: ['506'], directionId: 0 }),
    state('12338', { routeIds: ['506'], directionId: 1, state: 'fresh' }),
  ];
  const route = renderLitePage('/lite/r/506', tick(states), names);
  assert.match(route, /\[C\] 2 stops/);
  assert.match(route, /\[A\] 2 stops/);

  const detail = renderLitePage('/lite/stop/809', tick(states), names);
  assert.match(detail, /809\s+506 dir 0/);
  assert.match(detail, /12338\s+506 dir 1/);
});

test('stop-name fallback is pinned to the active network version', async () => {
  const DB = createDatabase(`
    CREATE TABLE network_versions (id INTEGER PRIMARY KEY, source_key TEXT, active INTEGER);
    CREATE TABLE map_artifacts (
      id INTEGER PRIMARY KEY, version_id INTEGER, mode TEXT, style TEXT, name TEXT,
      generator_version TEXT, etag TEXT, byte_size INTEGER, chunk_count INTEGER,
      created_at TEXT, active INTEGER
    );
    CREATE TABLE map_tags (name TEXT, artifact_id INTEGER, tag TEXT);
    CREATE TABLE map_stop_directory_chunks (artifact_id INTEGER, chunk_index INTEGER, payload TEXT);
    CREATE TABLE gtfs_stops (version_id INTEGER, stop_id TEXT, name TEXT);
    INSERT INTO network_versions VALUES (1, 'ttc-surface-gtfs', 0);
    INSERT INTO network_versions VALUES (2, 'ttc-surface-gtfs', 1);
    INSERT INTO gtfs_stops VALUES (1, '2123', 'OLD DUNDAS AT OLD STREET');
    INSERT INTO gtfs_stops VALUES (2, '2123', 'DUNDAS ST EAST AT ONTARIO ST');
  `);
  const response = await liteResponse(
    new Request('http://127.0.0.1:8787/lite/r/505/O'),
    {
      DB,
      LIVE_BUCKET: { get: async () => ({ body: JSON.stringify(tick([state('2123', { routeIds: ['505'] })])) }) },
    },
    { waitUntil() {} },
  );
  const html = await response.text();
  assert.match(html, /DUNDAS ST EAST AT ONTARIO ST/);
  assert.doesNotMatch(html, /OLD DUNDAS AT OLD STREET/);
});
