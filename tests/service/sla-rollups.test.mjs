import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileModules } from '../helpers/compile.mjs';
import { createDatabase } from '../helpers/database.mjs';

// Epic 8, E8S3: the Tier 3 fold. Hand-derived scenario: stop A has two
// 10:00-hour buckets of clockwork 10-minute headways (fully within the SLA)
// plus one 22:00-hour bucket whose hour carries no published service — it
// must stay in the display moments but OUT of the compliance denominator.
// Stop B runs the same clockwork in the promised hour only. The route row is
// the exact sum of its stops. Today's partial row is final=0. Weeks are the
// exact sum of their days. Aged-out and unpromised days are skipped honestly.
const { runSlaRollup, serviceConfig, torontoDayKey, torontoDayStartMs, torontoWeekKey } =
  await compileModules(`
  export { runSlaRollup } from './workers/api/src/sla/fold';
  export { serviceConfig } from './shared/service/config';
  export { torontoDayKey, torontoDayStartMs, torontoWeekKey } from './shared/service/sla-metrics';
`);

const config = serviceConfig();

async function freshDb() {
  const rollups = await readFile('migrations/0006_service_rollups.sql', 'utf8');
  const schedule = await readFile('migrations/0007_sla_schedule.sql', 'utf8');
  const tier3 = await readFile('migrations/0008_sla_rollups.sql', 'utf8');
  const db = createDatabase(`${rollups}\n${schedule}\n${tier3}
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

async function seedTargets(db, versionId, dayKeys) {
  await db
    .prepare(
      `INSERT INTO source_state (source_key, active_version_id) VALUES ('ttc-surface-gtfs', ?)`,
    )
    .bind(versionId)
    .run();
  for (const dayKey of dayKeys) {
    await db
      .prepare(
        `INSERT INTO sla_schedule_dates (version_id, date_key, class_key) VALUES (?, ?, 'w')`,
      )
      .bind(versionId, dayKey)
      .run();
  }
  const headways = JSON.stringify({ w: hourBands() });
  function hourBands() {
    const bands = Array.from({ length: 24 }, () => null);
    bands[10] = 600; // the 10:00 band promises a 10-minute headway
    return bands;
  }
  for (const stopId of ['sa', 'sb']) {
    await db
      .prepare(
        `INSERT INTO sla_schedule_targets
         (version_id, stop_id, name, direction_id, headsign, route_ids_json, headways_json, row_hash)
         VALUES (?, ?, ?, 0, 'eastbound', '["506"]', ?, 'hash1234')`,
      )
      .bind(versionId, stopId, `Stop ${stopId}`, headways)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO sla_route_targets
       (version_id, route_id, number, name, overnight, headways_json, stops_json, row_hash)
       VALUES (?, '506', '506', 'Carlton', 0, ?, ?, 'hash1234')`,
    )
    .bind(versionId, headways, JSON.stringify(['sa', 'sb']))
    .run();
}

async function seedBucket(db, stopId, bucketStart, n, sum, sumSq) {
  await db
    .prepare(
      `INSERT INTO service_rollups
       (stop_id, bucket_start, n, headway_sum, headway_sum_sq, max_gap_seconds,
        first_touch_at, last_touch_at, back_to_back, distinct_vehicles,
        route_ids, coverage_bits, fold_hash)
       VALUES (?, ?, ?, ?, ?, 600, 0, 0, 0, 1, '["506"]', 1023, 'hash1234')`,
    )
    .bind(stopId, bucketStart, n, sum, sumSq)
    .run();
}

/** Two clockwork buckets in the promised 10:00 hour (n=2, sum=1200 each —
 * two 600-second headways per bucket). */
async function seedClockworkHour(db, dayStart, hour, stops) {
  for (const stopId of stops) {
    await seedBucket(db, stopId, dayStart + hour * 3_600_000 + 300_000, 2, 1200, 720_000);
    await seedBucket(db, stopId, dayStart + hour * 3_600_000 + 600_000, 2, 1200, 720_000);
  }
}

test('the daily fold: clockwork is 100%, unpromised hours stay out of the denominator', async () => {
  const db = await freshDb();
  // Pin "now" at 11:00 Toronto today: yesterday is inside the fold's 12-hour
  // post-midnight grace (its earliest buckets still survive retention), and
  // today's 10:00 seeded buckets are already recorded — both folds see
  // deterministic data regardless of the wall clock the suite runs at.
  const todayKey = torontoDayKey(Date.now());
  const todayStart = torontoDayStartMs(todayKey);
  const nowMs = todayStart + 11 * 3_600_000;
  const yesterdayKey = torontoDayKey(nowMs - 86_400_000);
  const yesterdayStart = torontoDayStartMs(yesterdayKey);

  await seedTargets(db, 1, [yesterdayKey, todayKey]);
  // Yesterday: promised hour for both stops, plus an unpromised 22:00 bucket
  // for stop A only.
  await seedClockworkHour(db, yesterdayStart, 10, ['sa', 'sb']);
  await seedBucket(db, 'sa', yesterdayStart + 22 * 3_600_000, 2, 1200, 720_000);
  // Today (partial): promised hour so far.
  await seedClockworkHour(db, todayStart, 10, ['sa']);

  const result = await runSlaRollup(db, config, nowMs);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.foldedDays, [yesterdayKey]);
  assert.equal(result.todayPartial, todayKey);

  const stopA = await db
    .prepare(`SELECT * FROM sla_daily WHERE scope='stop' AND scope_id='sa' AND day_key=?`)
    .bind(yesterdayKey)
    .first();
  assert.ok(stopA, 'stop A day row exists');
  // Display moments count every observed headway (6 across the three
  // buckets)…
  assert.equal(stopA.services, 6);
  assert.equal(stopA.headway_sum, 3600);
  // …but the compliance denominator is the promised hour only (gap 2400),
  // where clockwork at θ=900 is exactly 100%.
  assert.equal(stopA.gap_seconds, 2400);
  assert.equal(stopA.compliant_seconds, 2400);
  assert.equal(stopA.final, 1);
  // Coverage counts the promised hour's slots (2 buckets × 10 slots × 30 s)
  // over the full recorded span (3 buckets × 300 s).
  assert.equal(stopA.coverage_seconds, 600);
  assert.equal(stopA.span_seconds, 900);

  const route = await db
    .prepare(
      `SELECT * FROM sla_daily WHERE scope='route' AND scope_id='506' AND day_key=?`,
    )
    .bind(yesterdayKey)
    .first();
  assert.ok(route, 'route day row exists');
  // The route row is the exact sum of its stops: services 10, moments 6000,
  // gap 4800 (both stops' promised hours), compliant 4800.
  assert.equal(route.services, 10);
  assert.equal(route.headway_sum, 6000);
  assert.equal(route.gap_seconds, 4800);
  assert.equal(route.compliant_seconds, 4800);

  // Today's partial: final=0, honest "so far".
  const todayRoute = await db
    .prepare(
      `SELECT * FROM sla_daily WHERE scope='route' AND scope_id='506' AND day_key=?`,
    )
    .bind(todayKey)
    .first();
  assert.ok(todayRoute, 'today partial route row exists');
  assert.equal(todayRoute.final, 0);
  assert.equal(todayRoute.services, 4);

  // The week row is the exact sum of its days and shares the fold's
  // week-liveness: final only when the whole week has passed.
  const week = await db
    .prepare(`SELECT * FROM sla_weekly WHERE scope='route' AND scope_id='506'`)
    .first();
  assert.ok(week, 'weekly row exists');
  const expectedServices = 10 + 4;
  assert.equal(week.services, expectedServices);
  assert.equal(week.gap_seconds, 2400 * 2 + 2400);
  assert.equal(
    week.final,
    torontoWeekKey(yesterdayKey) < torontoWeekKey(todayKey) ? 1 : 0,
  );

  // Idempotency: re-running reproduces every stored value.
  const before = await dumpDaily(db);
  await runSlaRollup(db, config, nowMs);
  assert.deepEqual(await dumpDaily(db), before);
});

async function dumpDaily(db) {
  const rows = await db
    .prepare(
      `SELECT scope, scope_id, day_key, services, headway_sum, headway_sum_sq,
                     max_gap_seconds, back_to_back, compliant_seconds, gap_seconds,
                     coverage_seconds, span_seconds, final, targets_version_id
              FROM sla_daily ORDER BY scope, scope_id, day_key`,
    )
    .all();
  return rows.results;
}

test('backfill self-heals within retention and skips honestly beyond it', async () => {
  const db = await freshDb();
  const todayKey = torontoDayKey(Date.now());
  const todayStart = torontoDayStartMs(todayKey);
  // Pin "now" at 11:00 Toronto: yesterday is inside the 12-hour grace (its
  // full data folds), the two days before it are beyond it (their early
  // buckets would be pruned), and four days ago is class-less.
  const nowMs = todayStart + 11 * 3_600_000;
  const dayKey = (offset) => torontoDayKey(nowMs - offset * 86_400_000);
  const yesterdayKey = dayKey(1);

  // The schedule promises every candidate day EXCEPT four days ago (a
  // class-less date: the feed publishes nothing for it).
  await seedTargets(db, 1, [dayKey(1), dayKey(2), dayKey(3), todayKey]);
  await seedClockworkHour(db, torontoDayStartMs(yesterdayKey), 10, ['sa', 'sb']);
  await seedClockworkHour(db, todayStart, 10, ['sa']);
  // Two days ago, seed its LATE hour-23 buckets — buckets that would still
  // physically survive the 36-hour prune at this pinned now. The day must
  // STILL be skipped: its early buckets are gone, so folding the survivors
  // would present a partial day as final. The skip is on the day's start,
  // never on what happens to remain.
  await seedClockworkHour(db, torontoDayStartMs(dayKey(2)), 23, ['sa']);
  // Pretend the fold last ran five days ago (folded_through = the last day
  // already considered), so the candidates include the class-less day four
  // days back.
  await db
    .prepare(`INSERT INTO sla_fold_meta (key, value) VALUES ('folded_through', ?)`)
    .bind(dayKey(5))
    .run();

  const result = await runSlaRollup(db, config, nowMs);
  assert.deepEqual(result.foldedDays, [yesterdayKey]);
  const reasons = new Map(
    result.skippedDays.map((entry) => [entry.dayKey, entry.reason]),
  );
  // Three and two days ago: their rollup data aged out of the 36-hour window
  // before the fold could reach them — honest absence, never fabricated zero.
  assert.equal(reasons.get(dayKey(3)), 'aged-out');
  assert.equal(reasons.get(dayKey(2)), 'aged-out');
  // Four days ago: the schedule has no promise for it (a class-less date).
  assert.equal(reasons.get(dayKey(4)), 'no-promise');
  // Nothing was written for any skipped day — including the partial-prune day
  // whose late buckets physically survive.
  const skipped = await db
    .prepare(`SELECT COUNT(*) AS n FROM sla_daily WHERE day_key NOT IN (?, ?)`)
    .bind(yesterdayKey, todayKey)
    .first();
  assert.equal(skipped.n, 0);
  // The marker advanced past the gap: the next run only considers new days.
  const meta = await db
    .prepare(`SELECT value FROM sla_fold_meta WHERE key='folded_through'`)
    .first();
  assert.equal(meta.value, yesterdayKey);
});

test('a fresh stack without targets or data reports honestly', async () => {
  const db = await freshDb();
  const noVersion = await runSlaRollup(db, config, Date.now());
  assert.equal(noVersion.status, 'no-targets');
  await db
    .prepare(
      `INSERT INTO source_state (source_key, active_version_id) VALUES ('ttc-surface-gtfs', 9)`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO sla_schedule_dates (version_id, date_key, class_key) VALUES (9, '2026-10-01', 'w')`,
    )
    .run();
  const noData = await runSlaRollup(db, config, Date.now());
  assert.equal(noData.status, 'no-data');
  assert.deepEqual(noData.foldedDays, []);
});
