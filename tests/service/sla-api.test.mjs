import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileModules } from '../helpers/compile.mjs';
import { createDatabase } from '../helpers/database.mjs';

// Epic 8, E8S4: `GET /api/v1/sla/report` through the real router — the
// precomputed-only contract, with E3S3's endpoint-test discipline: payload
// contract, ETag/304, filter semantics, and the honest collecting report.
const { api } = await compileModules(
  `export { default as api } from './workers/api/src/index';`,
);

// A never-caching edge cache stub (the history suite's pattern): with
// --test-isolation=none every test file's module code runs before any test,
// so a real caching stub here would leak entries into the /service suites'
// keys and theirs into ours. The ETag/304 behaviour is exercised through the
// fresh-response conditional path.
globalThis.caches = { default: { match: async () => null, put: async () => {} } };

async function freshSeededDb() {
  const schedule = await readFile('migrations/0007_sla_schedule.sql', 'utf8');
  const tier3 = await readFile('migrations/0008_sla_rollups.sql', 'utf8');
  const db = createDatabase(`${schedule}\n${tier3}
    CREATE TABLE source_state (
      source_key TEXT PRIMARY KEY,
      active_version_id INTEGER,
      r2_etag TEXT, source_url TEXT, source_etag TEXT,
      source_last_modified TEXT, source_content_length INTEGER,
      last_checked_at TEXT, last_full_fetch_at TEXT, last_changed_at TEXT,
      lock_until TEXT, last_error TEXT
    );`);
  return db;
}

async function seedReport(db) {
  const versionId = 1;
  await db
    .prepare(
      `INSERT INTO source_state (source_key, active_version_id) VALUES ('ttc-surface-gtfs', 1)`,
    )
    .run();
  // Dates carrying the three display classes (2026-10-07 is a Wednesday,
  // 2026-10-10 a Saturday, 2026-10-11 a Sunday).
  for (const [dateKey, classKey] of [
    ['2026-10-07', 'w'],
    ['2026-10-10', 'sat'],
    ['2026-10-11', 'sun'],
  ]) {
    await db
      .prepare(
        `INSERT INTO sla_schedule_dates (version_id, date_key, class_key) VALUES (?, ?, ?)`,
      )
      .bind(versionId, dateKey, classKey)
      .run();
  }
  function bandsOf(entries) {
    const bands = Array.from({ length: 24 }, () => null);
    for (const [hour, headway] of Object.entries(entries)) bands[Number(hour)] = headway;
    return bands;
  }
  const routes = [
    { routeId: '506', number: '506', name: 'Carlton', stops: ['sa', 'sb'] },
    { routeId: '301', number: '301', name: 'Queen', overnight: true, stops: ['sc'] },
  ];
  for (const route of routes) {
    await db
      .prepare(
        `INSERT INTO sla_route_targets
         (version_id, route_id, number, name, overnight, headways_json, stops_json, row_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'hash1234')`,
      )
      .bind(
        versionId,
        route.routeId,
        route.number,
        route.name,
        route.overnight ? 1 : 0,
        JSON.stringify({
          w: bandsOf({ 6: 300, 19: 600 }),
          sat: bandsOf({ 8: 480 }),
        }),
        JSON.stringify(route.stops),
      )
      .run();
  }
  const stops = [
    {
      stopId: 'sa',
      name: 'Carlton St at Bay St',
      headsign: 'eastbound',
      routes: ['506'],
    },
    {
      stopId: 'sb',
      name: 'Carlton St at Church St',
      headsign: 'westbound',
      routes: ['506'],
    },
    {
      stopId: 'sc',
      name: 'Queen St at Roncesvalles Ave',
      headsign: 'eastbound',
      routes: ['301'],
    },
  ];
  for (const stop of stops) {
    await db
      .prepare(
        `INSERT INTO sla_schedule_targets
         (version_id, stop_id, name, direction_id, headsign, route_ids_json, headways_json, row_hash)
         VALUES (?, ?, ?, 0, ?, ?, '{}', 'hash1234')`,
      )
      .bind(versionId, stop.stopId, stop.name, stop.headsign, JSON.stringify(stop.routes))
      .run();
  }
  // Day rows for two routes and one stop: a met day, a degraded day, a
  // missed day, and an unpromised (no-data) day.
  const rows = [
    ['route', '506', '2026-10-08', 240, 2340, 2400, 600, 1200, 1200, 'final'],
    ['route', '506', '2026-10-09', 240, 2000, 2400, 700, 1200, 1200, 'final'],
    ['route', '506', '2026-10-10', 240, 1200, 2400, 1500, 1200, 1200, 'final'],
    ['route', '506', '2026-10-11', 0, 0, 0, 0, 0, 0, 'final'],
    ['route', '301', '2026-10-09', 120, 1100, 1200, 600, 600, 600, 'final'],
    ['route', '506', '2026-10-12', 120, 1100, 1200, 600, 600, 600, 'partial'],
    ['stop', 'sa', '2026-10-09', 240, 2340, 2400, 600, 1200, 1200, 'final'],
    ['stop', 'sa', '2026-10-10', 240, 2000, 2400, 700, 1200, 1200, 'partial'],
  ];
  for (const [
    scope,
    scopeId,
    dayKey,
    services,
    compliant,
    gap,
    maxGap,
    coverage,
    span,
    finality,
  ] of rows) {
    await db
      .prepare(
        `INSERT INTO sla_daily
         (scope, scope_id, day_key, services, headway_sum, headway_sum_sq,
          max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
          coverage_seconds, span_seconds, final, targets_version_id, computed_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, 1, 0)`,
      )
      .bind(
        scope,
        scopeId,
        dayKey,
        services,
        maxGap,
        compliant,
        gap,
        coverage,
        span,
        finality === 'final' ? 1 : 0,
      )
      .run();
  }
  await db
    .prepare(
      `INSERT INTO sla_weekly
       (scope, scope_id, week_key, services, headway_sum, headway_sum_sq,
        max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
        coverage_seconds, span_seconds, final, targets_version_id, computed_at)
       VALUES ('route', '506', '2026-10-05', 960, 0, 0, 1500, 0, 5540, 7200, 3600, 3600, 1, 1, 0)`,
    )
    .run();
  return versionId;
}

const envFor = (db) => ({ DB: db });
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

test('the report serves precomputed rows only, with the /service family conventions', async () => {
  const db = await freshSeededDb();
  await seedReport(db);
  const response = await get('/api/v1/sla/report', envFor(db));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
  const etag = response.headers.get('etag');
  assert.ok(etag?.startsWith('"sla-'), 'etag prefix');

  const report = await response.json();
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.targets.versionId, 1);
  assert.equal(report.targets.toleranceRatio, 1.5);
  assert.equal(report.targets.metRatio, 0.9);
  assert.equal(report.targets.degradedRatio, 0.7);

  // Routes sorted by number, numerically (301 after 506 — wait: numerically
  // 301 < 506, so 301 first; the point is the numeric collation, not order).
  assert.deepEqual(
    report.routes.map((route) => route.number),
    ['301', '506'],
  );
  const route506 = report.routes.find((route) => route.routeId === '506');
  assert.ok(route506, '506 present');
  assert.equal(route506.name, 'Carlton');
  assert.equal(route506.overnight, false);

  // The published schedule compacted into bands — the SLA the TTC indicates,
  // on the advertised grid (the 5-minute band is quantized to 10 at serve time).
  assert.deepEqual(route506.published.weekday, [
    { fromHour: 6, toHour: 7, headwaySeconds: 600 },
    { fromHour: 19, toHour: 20, headwaySeconds: 600 },
  ]);
  // No holiday class in the seeded feed: a holiday is a date whose class
  // differs from the most recent same-weekday date's, and the seed has one
  // date per weekday — so the holiday line is honestly absent.
  assert.equal(route506.published.holiday, null);

  // Ticks: exactly the segments with data; a no-data day carries null
  // compliance, never a fabricated number.
  assert.deepEqual(
    route506.days.map((tick) => [tick.key, tick.compliance, tick.band, tick.final]),
    [
      ['2026-10-08', 0.975, 'met', true],
      ['2026-10-09', 0.8333, 'degraded', true],
      ['2026-10-10', 0.5, 'missed', true],
      ['2026-10-11', null, 'no-data', true],
      ['2026-10-12', 0.9167, 'met', false],
    ],
  );
  // The overall merges the RAW stored numbers (not the rounded ticks),
  // including the still-growing today row.
  const expectedOverall = Number(
    ((2340 + 2000 + 1200 + 1100) / (2400 * 3 + 1200)).toFixed(4),
  );
  assert.equal(route506.overall.compliance, expectedOverall);
  assert.equal(route506.overall.latestDayKey, '2026-10-12');
  assert.equal(report.dataThrough, '2026-10-12');

  // Weeks are wider-boxes data: one week row, exactly merged.
  const week = route506.weeks.find((tick) => tick.key === '2026-10-05');
  assert.ok(week, 'week tick present');
  assert.equal(week.compliance, Number((5540 / 7200).toFixed(4)));
  assert.equal(week.final, true);
});

test("?route= serves that route's directional stops with their strips", async () => {
  const db = await freshSeededDb();
  await seedReport(db);
  const response = await get('/api/v1/sla/report?route=506', envFor(db));
  assert.equal(response.status, 200);
  const report = await response.json();
  const stops = report.stops ?? [];
  assert.deepEqual(
    stops.map((stop) => stop.stopId),
    ['sa', 'sb'],
  );
  const stopA = stops.find((stop) => stop.stopId === 'sa');
  assert.equal(stopA.name, 'Carlton St at Bay St');
  assert.equal(stopA.headsign, 'eastbound');
  assert.deepEqual(stopA.routeIds, ['506']);
  assert.deepEqual(
    stopA.days.map((tick) => tick.band),
    ['met', 'degraded'],
  );
  // An unknown route is an honest empty detail, not an error.
  const unknown = await get('/api/v1/sla/report?route=999', envFor(db));
  assert.equal(unknown.status, 200);
  assert.deepEqual((await unknown.json()).stops, []);
});

test('ETag serves 304 for a repeat report fetch', async () => {
  const db = await freshSeededDb();
  await seedReport(db);
  const first = await get('/api/v1/sla/report', envFor(db));
  const etag = first.headers.get('etag');
  const second = await get('/api/v1/sla/report', envFor(db), { 'if-none-match': etag });
  assert.equal(second.status, 304);
});

test('a stack with no import yet serves the honest collecting report', async () => {
  const db = await freshSeededDb();
  const response = await get('/api/v1/sla/report', envFor(db));
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.routes.length, 0);
  assert.equal(report.dataThrough, null);
  assert.equal(report.overall.band, 'no-data');
});

test('the report payload stays within the house byte budget at realistic scale', async () => {
  const db = await freshSeededDb();
  await seedReport(db);
  // Worst realistic shape: 17 routes x 90 day rows + 14 week rows each, all
  // with full precision — the page never asks for more than this.
  const dayKeyOf = (offset) => {
    const date = new Date(Date.UTC(2026, 6, 1) + offset * 86_400_000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };
  for (let route = 0; route < 17; route += 1) {
    for (let day = 0; day < 90; day += 1) {
      await db
        .prepare(
          `INSERT INTO sla_daily
           (scope, scope_id, day_key, services, headway_sum, headway_sum_sq,
            max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
            coverage_seconds, span_seconds, final, targets_version_id, computed_at)
           VALUES ('route', ?, ?, 240, 0, 0, 600, 0, 111.11111, 2400, 1200, 1200, 1, 1, 0)`,
        )
        .bind(`50${route}`, dayKeyOf(day))
        .run();
    }
    for (let week = 0; week < 14; week += 1) {
      await db
        .prepare(
          `INSERT INTO sla_weekly
           (scope, scope_id, week_key, services, headway_sum, headway_sum_sq,
            max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
            coverage_seconds, span_seconds, final, targets_version_id, computed_at)
           VALUES ('route', ?, ?, 1680, 0, 0, 600, 0, 111.11111, 16800, 8400, 8400, 1, 1, 0)`,
        )
        .bind(`50${route}`, dayKeyOf(week * 7))
        .run();
    }
  }
  const response = await get('/api/v1/sla/report', envFor(db));
  const bytes = new TextEncoder().encode(await response.text()).length;
  assert.ok(
    bytes < 200 * 1024,
    `report payload ${bytes} bytes exceeds the 200 KB budget`,
  );
});
