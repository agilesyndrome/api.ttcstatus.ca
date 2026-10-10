import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { compileModules } from '../helpers/compile.mjs';

// Epic 8, E8S1: the promise derives from the feed the TTC itself publishes.
// A synthetic GTFS zip through the REAL parser + derivation, with hand-set
// departures; every expected band derived by hand below. The zip builder is
// the tests/security/archive.test.mjs pattern, extended to many entries.
const { parseStreetcarGtfs, deriveSlaSchedule, R2ZipArchive } = await compileModules(`
  export { parseStreetcarGtfs } from './workers/shared/gtfs/parser';
  export { deriveSlaSchedule } from './workers/shared/gtfs/sla-schedule';
  export { R2ZipArchive } from './workers/shared/gtfs/zip';
`);

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const content = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 10);
    local.writeUInt32LE(content.length, 20);
    local.writeUInt32LE(Buffer.byteLength(text), 24);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(Buffer.byteLength(text), 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, content);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + content.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50, 0);
  tail.writeUInt16LE(entries.length, 10);
  tail.writeUInt32LE(centralBytes.length, 12);
  tail.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, tail]);
}

function bucketFor(bytes) {
  return {
    async head() {
      return { size: bytes.length };
    },
    async get(_key, { range }) {
      return {
        body: new Response(bytes.subarray(range.offset, range.offset + range.length))
          .body,
      };
    },
  };
}

/** One corridor, two stops, three service classes, a night route sharing the
 * corridor with the day route, and a subway line — small enough that every
 * band below was derived by hand. */
function fixtureArchive() {
  const routes = [
    'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type',
    '506,1,506,Carlton,,0',
    '306,1,306,Carlton Night,,0',
    '60,1,60,The 60th parallel bus,,3',
    '5,1,5,Eglinton Line,,0',
  ].join('\n');
  const trips = [
    'trip_id,route_id,service_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id',
    't_wd_a1,506,1,East - Main St Station,,0,blk,shp1',
    't_wd_a2,506,1,East - Main St Station,,0,blk,shp1',
    't_wd_a3,506,1,East - Main St Station,,0,blk,shp1',
    't_306_a1,306,1,Night - Carlton,,0,blk,shp1',
    't_306_a2,306,1,Night - Carlton,,0,blk,shp1',
    't_sub_1,5,1,West - Line 5,,0,blk,shp1',
    't_sub_2,5,1,West - Line 5,,0,blk,shp1',
    't_wd_b1,506,1,East - Main St Station,,0,blk,shp1',
    't_wd_b2,506,1,East - Main St Station,,0,blk,shp1',
    't_wd_b3,506,1,East - Main St Station,,0,blk,shp1',
    't_sat_a1,506,2,East - Main St Station,,0,blk,shp1',
    't_sat_a2,506,2,East - Main St Station,,0,blk,shp1',
    't_hol_a1,506,5,East - Main St Station,,0,blk,shp1',
    't_hol_a2,506,5,East - Main St Station,,0,blk,shp1',
  ].join('\n');
  const stopTimes = [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled,timepoint',
    't_wd_a1,08:00:00,08:00:00,st_a,1,0,1',
    't_wd_a2,08:10:00,08:10:00,st_a,2,0,1',
    't_wd_a3,08:20:00,08:20:00,st_a,3,0,1',
    't_306_a1,20:00:00,20:00:00,st_a,1,0,1',
    't_306_a2,20:30:00,20:30:00,st_a,2,0,1',
    't_sub_1,07:00:00,07:00:00,st_sub,1,0,1',
    't_sub_2,07:03:00,07:03:00,st_sub,2,0,1',
    't_wd_b1,08:00:00,08:00:00,st_b,1,0,1',
    't_wd_b2,08:05:00,08:05:00,st_b,2,0,1',
    't_wd_b3,08:10:00,08:10:00,st_b,3,0,1',
    't_sat_a1,09:00:00,09:00:00,st_a,1,0,1',
    't_sat_a2,09:20:00,09:20:00,st_a,2,0,1',
    't_hol_a1,10:00:00,10:00:00,st_a,1,0,1',
    't_hol_a2,10:15:00,10:15:00,st_a,2,0,1',
  ].join('\n');
  const stops = [
    'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
    'st_a,Carlton St at Bay St,43.66,-79.39,0,',
    'st_b,Carlton St at Church St,43.66,-79.38,0,',
    'st_sub,Queen Station,43.65,-79.38,0,',
  ].join('\n');
  const shapes =
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nshp1,43.66,-79.39,1'.split(
      '\n',
    )[0];
  const calendar = [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    '1,1,1,1,1,1,0,0,20261001,20261031',
    '2,0,0,0,0,0,1,0,20261001,20261031',
    '3,0,0,0,0,0,0,1,20261001,20261031',
  ].join('\n');
  const calendarDates = [
    'service_id,date,exception_type',
    '1,20261012,2',
    '5,20261012,1',
  ].join('\n');
  return buildZip([
    ['routes.txt', routes],
    ['trips.txt', trips],
    ['stop_times.txt', stopTimes],
    ['stops.txt', stops],
    ['shapes.txt', `${shapes}\nshp1,43.66,-79.38,2`],
    ['calendar.txt', calendar],
    ['calendar_dates.txt', calendarDates],
  ]);
}

test('the schedule the TTC publishes becomes the promise, per class', async () => {
  const parsed = await parseStreetcarGtfs(
    await R2ZipArchive.open(bucketFor(fixtureArchive()), 'fixture'),
  );
  const targets = deriveSlaSchedule(parsed);

  // Dates: Oct 1 2026 is a Thursday (class '1'); Oct 3 is a Saturday ('2');
  // Oct 4 is a Sunday whose service set has no streetcar trips, so the date
  // publishes no promise and is skipped; Oct 12 is the holiday Monday whose
  // streetcar set is exactly {5}.
  const byDate = new Map(targets.dates.map((entry) => [entry.dateKey, entry.classKey]));
  assert.equal(byDate.get('2026-10-01'), '1');
  assert.equal(byDate.get('2026-10-03'), '2');
  assert.equal(byDate.has('2026-10-04'), false);
  assert.equal(byDate.get('2026-10-12'), '5');

  // Stop A's promise pools every streetcar route serving it: weekday 10-minute
  // 506 headways (08:00, 08:10, 08:20 → median band 8 = 600, the 08:20→20:00
  // cross-period gap kept out of the median by the two 600 s gaps) PLUS the
  // 306's evening (20:00, 20:30 → band 20 = 1800). Saturday 20-minute
  // (09:00, 09:20 → band 9 = 1200); holiday 15-minute (10:00, 10:15 → band
  // 10 = 900). Nothing else is scheduled.
  const stopA = targets.stops.find((stop) => stop.stopId === 'st_a');
  assert.ok(stopA, 'stop A present');
  assert.equal(stopA.name, 'Carlton St at Bay St');
  assert.equal(stopA.directionId, 0);
  assert.equal(stopA.headsign, 'East - Main St Station');
  assert.deepEqual(stopA.routeIds, ['306', '506']);
  assert.equal(stopA.headways['1'][8], 600);
  assert.equal(stopA.headways['1'][20], 1800);
  assert.equal(stopA.headways['1'][9], null);
  assert.equal(stopA.headways['2'][9], 1200);
  assert.equal(stopA.headways['5'][10], 900);
  assert.equal(stopA.headways['2'][8], null);

  // Stop B: real 5-minute headways (08:00, 08:05, 08:10) publish as the
  // advertised 10-minute promise — the TTC never advertises better than 10.
  const stopB = targets.stops.find((stop) => stop.stopId === 'st_b');
  assert.ok(stopB, 'stop B present');
  assert.equal(stopB.headways['1'][8], 600);
  assert.equal(stopB.headways['2'], undefined);

  // The 506's own published promise is the median across its stops of ITS OWN
  // departures, on the advertised grid: hour 8 weekday = median(600, 600) =
  // 600 — and hour 20 is null, because the 506's own weekday service ends
  // long before 20:00.
  const route = targets.routes.find((entry) => entry.routeId === '506');
  assert.ok(route, 'route present');
  assert.equal(route.number, '506');
  assert.equal(route.name, 'Carlton');
  assert.equal(route.overnight, false);
  assert.deepEqual(route.stopIds, ['st_a', 'st_b']);
  assert.equal(route.headways['1'][8], 600);
  assert.equal(route.headways['1'][20], null);
  assert.equal(route.headways['2'][9], 1200);

  // The night route publishes only its own service span: the 306's route
  // bands are null in the 506's daytime hours and 1800 s in its own evening —
  // it never inherits the 506's daytime promise from their shared corridor.
  const nightRoute = targets.routes.find((entry) => entry.routeId === '306');
  assert.ok(nightRoute, 'night route present');
  assert.equal(nightRoute.overnight, true);
  assert.deepEqual(nightRoute.stopIds, ['st_a']);
  assert.equal(nightRoute.headways['1'][8], null);
  assert.equal(nightRoute.headways['1'][20], 1800);
  assert.equal(nightRoute.headways['2'], undefined);

  // The page is streetcar service (the E7S7 steering): the rapid lines —
  // including the Line 5 LRT, which is route_type 0 like a streetcar and so
  // only the number rule catches it — and their stations publish no promise
  // here, even though the parser carried their materials.
  assert.equal(
    targets.routes.some((entry) => entry.routeId === '5'),
    false,
    'the rapid line must not appear in SLA targets',
  );
  assert.equal(
    targets.stops.some((stop) => stop.stopId === 'st_sub'),
    false,
    'a rapid-only stop must not appear in SLA targets',
  );
  assert.deepEqual(targets.routes.map((entry) => entry.number).sort(), ['306', '506']);

  // Derivation is deterministic: same materials, same targets.
  assert.deepEqual(deriveSlaSchedule(parsed), targets);
});

test('the raw schedule materials ride the parser the import already pays for', async () => {
  const parsed = await parseStreetcarGtfs(
    await R2ZipArchive.open(bucketFor(fixtureArchive()), 'fixture'),
  );
  // Every streetcar and subway trip — not just pattern representatives —
  // with its class and headsign; departures keyed per stop per service per
  // ROUTE (the route dimension keeps night routes' promises their own).
  assert.equal(parsed.schedule.trips.size, 14);
  assert.equal(parsed.schedule.trips.get('t_hol_a1').serviceId, '5');
  assert.equal(parsed.schedule.trips.get('t_306_a1').routeId, '306');
  const stopA = parsed.schedule.departuresByStop.get('st_a');
  assert.deepEqual(stopA.get('1').get('506'), [28_800, 29_400, 30_000]);
  assert.deepEqual(stopA.get('1').get('306'), [72_000, 73_800]);
  assert.deepEqual(stopA.get('5').get('506'), [36_000, 36_900]);
  assert.deepEqual(
    parsed.schedule.departuresByStop.get('st_sub').get('1').get('5'),
    [25_200, 25_380],
  );
  assert.equal(parsed.schedule.calendarExceptions.length, 2);
  assert.equal(parsed.schedule.stopHeadsigns.get('st_a'), 'East - Main St Station');
});

// The full import path (importNetworkVersion) needs a feed that passes the
// existing sanity rails: >= 8 routes, >= 50 stops, patterns and shapes for
// each route. Generated mechanically; the 506 keeps the hand-set timetable.
function bigFixtureArchive() {
  const routes = [
    'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type',
    '506,1,506,Carlton,,0',
  ];
  const trips = [
    'trip_id,route_id,service_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id',
  ];
  const stopTimes = [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled,timepoint',
  ];
  const stops = ['stop_id,stop_name,stop_lat,stop_lon,location_type'];
  const shapes = ['shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence'];
  for (let route = 0; route < 8; route += 1) {
    const routeId = `50${6 + route}`;
    if (route > 0) routes.push(`${routeId},1,${routeId},Corridor ${route},,0`);
    // Two trips ten minutes apart: a stop's promise is the gap between
    // consecutive departures, so one trip alone would publish none.
    trips.push(`t_${routeId},50${6 + route},1,Headsign ${route},,0,blk,shp_${route}`);
    trips.push(`t_${routeId}b,50${6 + route},1,Headsign ${route},,0,blk,shp_${route}`);
    shapes.push(`shp_${route},43.6,-79.3,1`, `shp_${route},43.7,-79.4,2`);
    for (let stop = 0; stop < 52; stop += 1) {
      const stopId = `st_${route}_${stop}`;
      stops.push(`${stopId},Stop ${route}-${stop},43.6,-79.3,0`);
      const seconds = 8 * 3600 + stop * 30;
      const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      const laterSeconds = seconds + 600;
      const hh2 = String(Math.floor(laterSeconds / 3600)).padStart(2, '0');
      const mm2 = String(Math.floor((laterSeconds % 3600) / 60)).padStart(2, '0');
      const ss2 = String(laterSeconds % 60).padStart(2, '0');
      stopTimes.push(
        `t_${routeId},${hh}:${mm}:${ss},${hh}:${mm}:${ss},${stopId},${stop + 1},0,0`,
        `t_${routeId}b,${hh2}:${mm2}:${ss2},${hh2}:${mm2}:${ss2},${stopId},${stop + 1},0,0`,
      );
    }
  }
  const calendar = [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    '1,1,1,1,1,1,0,0,20261001,20261031',
  ].join('\n');
  const calendarDates = 'service_id,date,exception_type\n';
  return buildZip([
    ['routes.txt', routes.join('\n')],
    ['trips.txt', trips.join('\n')],
    ['stop_times.txt', stopTimes.join('\n')],
    ['stops.txt', stops.join('\n')],
    ['shapes.txt', shapes.join('\n')],
    ['calendar.txt', calendar],
    ['calendar_dates.txt', calendarDates],
  ]);
}

test('the nightly import persists the promise with the map rows, idempotently', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createDatabase } = await import('../helpers/database.mjs');
  const { importNetworkVersion } = await compileModules(`
    export { importNetworkVersion } from './workers/api/src/sync/import-version';
  `);
  const initial = await readFile('migrations/0001_initial.sql', 'utf8');
  const schedule = await readFile('migrations/0007_sla_schedule.sql', 'utf8');
  const db = createDatabase(`${initial}\n${schedule}`);
  await db
    .prepare(
      `INSERT INTO network_versions (source_key, source_url, r2_etag, r2_key, fetched_at, status)
       VALUES ('ttc-surface-gtfs', 'src', 'etag-x', 'gtfs.zip', '2026-10-09T00:00:00Z', 'downloaded')`,
    )
    .run();
  const archive = bucketFor(bigFixtureArchive());
  const env = { DB: db, GTFS_BUCKET: archive };

  const version = { id: 1, r2_key: 'gtfs.zip', status: 'downloaded' };
  await importNetworkVersion(env, version);
  assert.equal(version.status, 'imported');

  const counts = async (table, where = '', ...args) =>
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`)
        .bind(...args)
        .first()
    ).n;
  assert.equal(await counts('gtfs_routes', 'WHERE version_id = 1'), 8);
  // 31 calendar days, minus the 9 weekend days the fixture's service 1 does
  // not cover — dates without published streetcar service are honestly absent.
  assert.equal(await counts('sla_schedule_dates', 'WHERE version_id = 1'), 22);
  assert.equal(await counts('sla_schedule_targets', 'WHERE version_id = 1'), 8 * 52);
  assert.equal(await counts('sla_route_targets', 'WHERE version_id = 1'), 8);
  // Every route's stops_json is a valid corridor membership list.
  const route = await db
    .prepare(
      `SELECT stops_json FROM sla_route_targets WHERE version_id = 1 AND route_id = '506'`,
    )
    .first();
  const stopIds = JSON.parse(route.stops_json);
  assert.equal(stopIds.length, 52);
  assert.ok(stopIds.includes('st_0_51'));

  // A retried import of the same version replaces the SLA rows idempotently.
  await importNetworkVersion(env, { id: 1, r2_key: 'gtfs.zip', status: 'failed_import' });
  assert.equal(await counts('sla_route_targets', 'WHERE version_id = 1'), 8);
  assert.equal(await counts('sla_schedule_targets', 'WHERE version_id = 1'), 8 * 52);
});

test('the operator backfill restores the promise for an already-imported version', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createDatabase } = await import('../helpers/database.mjs');
  const { importNetworkVersion, backfillSlaSchedule } = await compileModules(`
    export { importNetworkVersion, backfillSlaSchedule } from './workers/api/src/sync/import-version';
  `);
  const initial = await readFile('migrations/0001_initial.sql', 'utf8');
  const schedule = await readFile('migrations/0007_sla_schedule.sql', 'utf8');
  const db = createDatabase(`${initial}\n${schedule}`);
  await db
    .prepare(
      `INSERT INTO network_versions (source_key, source_url, r2_etag, r2_key, fetched_at, status)
       VALUES ('ttc-surface-gtfs', 'src', 'etag-x', 'gtfs.zip', '2026-10-09T00:00:00Z', 'downloaded')`,
    )
    .run();
  const archive = bucketFor(bigFixtureArchive());
  await importNetworkVersion(
    { DB: db, GTFS_BUCKET: archive },
    { id: 1, r2_key: 'gtfs.zip', status: 'downloaded' },
  );

  const snapshot = async () => ({
    dates: (
      await db
        .prepare(
          `SELECT * FROM sla_schedule_dates WHERE version_id = 1 ORDER BY date_key`,
        )
        .all()
    ).results,
    stops: (
      await db
        .prepare(
          `SELECT * FROM sla_schedule_targets WHERE version_id = 1 ORDER BY stop_id`,
        )
        .all()
    ).results,
    routes: (
      await db
        .prepare(`SELECT * FROM sla_route_targets WHERE version_id = 1 ORDER BY route_id`)
        .all()
    ).results,
  });
  const imported = await snapshot();

  // Simulate the pre-promise-lens deployment: the version's SLA rows are gone.
  await db.batch([
    db.prepare(`DELETE FROM sla_route_targets WHERE version_id = 1`),
    db.prepare(`DELETE FROM sla_schedule_targets WHERE version_id = 1`),
    db.prepare(`DELETE FROM sla_schedule_dates WHERE version_id = 1`),
  ]);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM sla_schedule_targets`).first()).n,
    0,
    'fixture starts with the promise missing',
  );

  const backfillEnv = {
    DB: db,
    GTFS_BUCKET: archive,
    STATIC_GTFS_URL: 'https://feed.test/static.zip',
  };
  const result = await backfillSlaSchedule(backfillEnv, { id: 1, r2_key: 'gtfs.zip' });
  assert.equal(result.dates, 22);
  assert.equal(result.stops, 8 * 52);
  assert.equal(result.routes, 8);
  assert.equal(result.dryRun, false);
  // The restored rows are identical to the ones the import itself wrote.
  assert.deepEqual(await snapshot(), imported);
  // GTFS rows were never touched.
  assert.equal(
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM gtfs_routes WHERE version_id = 1`)
        .first()
    ).n,
    8,
  );

  // Idempotent: a repeated backfill reproduces the same rows.
  await backfillSlaSchedule(backfillEnv, { id: 1, r2_key: 'gtfs.zip' });
  assert.deepEqual(await snapshot(), imported);

  // Dry-run reports the same derivation without writing anything.
  await db.batch([
    db.prepare(`DELETE FROM sla_route_targets WHERE version_id = 1`),
    db.prepare(`DELETE FROM sla_schedule_targets WHERE version_id = 1`),
    db.prepare(`DELETE FROM sla_schedule_dates WHERE version_id = 1`),
  ]);
  const dry = await backfillSlaSchedule(
    backfillEnv,
    { id: 1, r2_key: 'gtfs.zip' },
    {
      dryRun: true,
    },
  );
  assert.deepEqual(
    { dates: dry.dates, stops: dry.stops, routes: dry.routes },
    { dates: 22, stops: 8 * 52, routes: 8 },
  );
  assert.equal(dry.dryRun, true);
  assert.equal(
    (await db.prepare(`SELECT COUNT(*) AS n FROM sla_schedule_targets`).first()).n,
    0,
    'dry-run writes nothing',
  );
});
