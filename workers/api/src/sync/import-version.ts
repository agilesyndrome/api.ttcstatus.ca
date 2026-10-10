import {
  parseStreetcarGtfs,
  type ParsedStreetcarGtfs,
} from '../../../shared/gtfs/parser';
import {
  deriveSlaSchedule,
  slaScheduleRowHash,
  type SlaScheduleTargets,
} from '../../../shared/gtfs/sla-schedule';
import { R2ZipArchive } from '../../../shared/gtfs/zip';
import { nowIso, runBatches, type NetworkVersion, type SyncEnv } from './sync-common';

/** Remove any partial rows from a failed/retried import of the same version. */
async function clearVersionRows(env: SyncEnv, versionId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM gtfs_pattern_stops WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_stops WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_shapes WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_patterns WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_routes WHERE version_id = ?`).bind(versionId),
    // The promise lens ships with the same version flip (Epic 8, E8S1).
    env.DB.prepare(`DELETE FROM sla_route_targets WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM sla_schedule_targets WHERE version_id = ?`).bind(
      versionId,
    ),
    env.DB.prepare(`DELETE FROM sla_schedule_dates WHERE version_id = ?`).bind(versionId),
  ]);
}

/**
 * Coarse safety rails against accidentally publishing a malformed or wrong feed.
 * These are intentionally simple lower bounds; topology validation belongs in
 * the map-generation phase as that implementation matures.
 */
function validateStreetcarImport(parsed: ParsedStreetcarGtfs): void {
  const { stats } = parsed;
  if (stats.routeCount < 8) {
    throw new Error(
      `Streetcar import sanity check failed: only ${stats.routeCount} routes`,
    );
  }
  if (stats.patternCount < stats.routeCount) {
    throw new Error('Streetcar import sanity check failed: too few patterns');
  }
  if (stats.shapeCount < stats.routeCount) {
    throw new Error('Streetcar import sanity check failed: too few shapes');
  }
  if (stats.stopCount < 50) {
    throw new Error(
      `Streetcar import sanity check failed: only ${stats.stopCount} stops`,
    );
  }
  if (stats.patternStopCount < stats.stopCount) {
    throw new Error('Streetcar import sanity check failed: too few pattern-stop rows');
  }
}

/** Write normalized GTFS rows in bounded D1 batches. */
async function persistNormalizedGtfs(
  env: SyncEnv,
  versionId: number,
  parsed: ParsedStreetcarGtfs,
): Promise<void> {
  await clearVersionRows(env, versionId);

  await runBatches(
    env,
    parsed.routes.map((route) =>
      env.DB.prepare(
        `INSERT INTO gtfs_routes (
       version_id, route_id, short_name, long_name, route_type, color, text_color, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        route.routeId,
        route.shortName,
        route.longName,
        route.routeType,
        route.color,
        route.textColor,
        route.rowHash,
      ),
    ),
  );

  await runBatches(
    env,
    parsed.patterns.map((pattern) =>
      env.DB.prepare(
        `INSERT INTO gtfs_patterns (
       version_id, pattern_id, route_id, direction_id, shape_id, headsign,
       representative_trip_id, trip_count, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        pattern.patternId,
        pattern.routeId,
        pattern.directionId,
        pattern.shapeId,
        pattern.headsign,
        pattern.representativeTripId,
        pattern.tripCount,
        pattern.rowHash,
      ),
    ),
  );

  await runBatches(
    env,
    parsed.shapes.map((shape) =>
      env.DB.prepare(
        `INSERT INTO gtfs_shapes (
       version_id, shape_id, points_json, point_count, row_hash
     ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        shape.shapeId,
        JSON.stringify(shape.points),
        shape.points.length,
        shape.rowHash,
      ),
    ),
  );

  await runBatches(
    env,
    parsed.stops.map((stop) =>
      env.DB.prepare(
        `INSERT INTO gtfs_stops (
       version_id, stop_id, name, lat, lon, location_type, parent_station,
       wheelchair_boarding, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        stop.stopId,
        stop.name,
        stop.lat,
        stop.lon,
        stop.locationType,
        stop.parentStation,
        stop.wheelchairBoarding,
        stop.rowHash,
      ),
    ),
  );

  await runBatches(
    env,
    parsed.patternStops.map((stop) =>
      env.DB.prepare(
        `INSERT INTO gtfs_pattern_stops (
       version_id, pattern_id, stop_id, stop_sequence, row_hash
     ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(versionId, stop.patternId, stop.stopId, stop.sequence, stop.rowHash),
    ),
  );
}

/** The promise lens's sanity rails (Epic 8, E8S1): a feed that publishes no
 * streetcar schedule at all has no promises to compare against — the map can
 * still import, but the SLA page would be lying if we let it, so fail loudly
 * and retry at the next sync like every other import problem. */
function validateSlaSchedule(targets: SlaScheduleTargets): void {
  if (targets.dates.length === 0) {
    throw new Error('SLA schedule import found no calendar dates');
  }
  if (targets.stops.length === 0) {
    throw new Error('SLA schedule import found no streetcar scheduled stops');
  }
  if (targets.routes.length === 0) {
    throw new Error('SLA schedule import found no streetcar scheduled routes');
  }
}

/** The complete open-data feed carries the rapid lines as well as streetcars;
 * one that is missing any Line's geometry is wrong at the source, so refuse
 * it. Streetcar-only feeds are exempt. Shared by the import and the
 * operator backfill. */
function validateCompleteFeedRailLines(
  parsed: ParsedStreetcarGtfs,
  sourceUrl: string,
): void {
  if (!/completegtfs\.zip/i.test(sourceUrl)) return;
  for (const number of ['1', '2', '4', '5', '6']) {
    const route = parsed.routes.find((r) => r.shortName === number);
    if (
      !route ||
      !parsed.patterns.some(
        (p) =>
          p.routeId === route.routeId &&
          parsed.shapes.some((s) => s.shapeId === p.shapeId && s.points.length > 1),
      )
    )
      throw new Error(`Complete GTFS is missing rail geometry for Line ${number}`);
  }
}

/** Persist the derived schedule targets (E8S1): date → class, per-stop bands,
 * per-route published bands. Same bounded-batch discipline as the map rows. */
async function persistSlaSchedule(
  env: Pick<SyncEnv, 'DB'>,
  versionId: number,
  targets: SlaScheduleTargets,
): Promise<void> {
  await runBatches(
    env,
    targets.dates.map((entry) =>
      env.DB.prepare(
        `INSERT INTO sla_schedule_dates (version_id, date_key, class_key) VALUES (?, ?, ?)`,
      ).bind(versionId, entry.dateKey, entry.classKey),
    ),
  );

  await runBatches(
    env,
    targets.stops.map((stop) =>
      env.DB.prepare(
        `INSERT INTO sla_schedule_targets (
       version_id, stop_id, name, direction_id, headsign, route_ids_json, headways_json, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        stop.stopId,
        stop.name,
        stop.directionId,
        stop.headsign,
        JSON.stringify(stop.routeIds),
        JSON.stringify(stop.headways),
        slaScheduleRowHash([stop.stopId, stop.name, JSON.stringify(stop.headways)]),
      ),
    ),
  );

  await runBatches(
    env,
    targets.routes.map((route) =>
      env.DB.prepare(
        `INSERT INTO sla_route_targets (
       version_id, route_id, number, name, overnight, headways_json, stops_json, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        route.routeId,
        route.number,
        route.name,
        route.overnight ? 1 : 0,
        JSON.stringify(route.headways),
        JSON.stringify(route.stopIds),
        slaScheduleRowHash([route.routeId, route.number, JSON.stringify(route.headways)]),
      ),
    ),
  );
}

/**
 * Parse the already-cached R2 ZIP and materialize its streetcar subset in D1.
 * This function never reaches back to the TTC source; all source traffic is
 * confined to sync.ts so a reviewer can audit data-citizenship behavior easily.
 */
export async function importNetworkVersion(
  env: SyncEnv,
  version: NetworkVersion,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE network_versions SET status = 'importing', error = NULL WHERE id = ?`,
  )
    .bind(version.id)
    .run();

  const archive = await R2ZipArchive.open(env.GTFS_BUCKET, version.r2_key);
  const parsed = await parseStreetcarGtfs(archive);
  validateStreetcarImport(parsed);
  validateCompleteFeedRailLines(parsed, env.STATIC_GTFS_URL);
  await persistNormalizedGtfs(env, version.id, parsed);

  // The promise lens (Epic 8, E8S1): derive the schedule's own SLA bands from
  // the same parsed feed — no new download, no new upstream traffic — and
  // persist them with the version. A failure here fails the import loudly and
  // retries at the next sync; the active version (and its targets) are never
  // left half-flipped.
  const slaTargets = deriveSlaSchedule(parsed);
  validateSlaSchedule(slaTargets);
  await persistSlaSchedule(env, version.id, slaTargets);

  await env.DB.prepare(
    `UPDATE network_versions
     SET status = 'imported', error = NULL, imported_at = ?,
         route_count = ?, pattern_count = ?, shape_count = ?, stop_count = ?, pattern_stop_count = ?
     WHERE id = ?`,
  )
    .bind(
      nowIso(),
      parsed.stats.routeCount,
      parsed.stats.patternCount,
      parsed.stats.shapeCount,
      parsed.stats.stopCount,
      parsed.stats.patternStopCount,
      version.id,
    )
    .run();

  version.status = 'imported';
}

/** Operator backfill (scripts/operations/sla-schedule.mjs `targets`):
 * re-derive and persist the promise lens for an ALREADY-IMPORTED version, from
 * the same retained R2 archive the import read — no upstream traffic, no GTFS
 * row changes, no map regeneration. This is the motion a deployment needs
 * when it ships new derived tables after a version was imported (the promise
 * lens itself: versions imported before Epic 8 have no SLA rows, and the
 * unchanged-feed sync path never reprocesses, by design). Idempotent — the
 * version's SLA rows are cleared and re-derived from the same archive, so a
 * repeated run reproduces byte-identical rows. The caller owns the sync lock. */
export async function backfillSlaSchedule(
  env: Pick<SyncEnv, 'DB' | 'GTFS_BUCKET' | 'STATIC_GTFS_URL'>,
  version: Pick<NetworkVersion, 'id' | 'r2_key'>,
  opts: { dryRun?: boolean } = {},
): Promise<{ dates: number; stops: number; routes: number; dryRun: boolean }> {
  const archive = await R2ZipArchive.open(env.GTFS_BUCKET, version.r2_key);
  const parsed = await parseStreetcarGtfs(archive);
  validateStreetcarImport(parsed);
  validateCompleteFeedRailLines(parsed, env.STATIC_GTFS_URL);
  const slaTargets = deriveSlaSchedule(parsed);
  validateSlaSchedule(slaTargets);
  if (opts.dryRun) {
    return {
      dates: slaTargets.dates.length,
      stops: slaTargets.stops.length,
      routes: slaTargets.routes.length,
      dryRun: true,
    };
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sla_route_targets WHERE version_id = ?`).bind(version.id),
    env.DB.prepare(`DELETE FROM sla_schedule_targets WHERE version_id = ?`).bind(
      version.id,
    ),
    env.DB.prepare(`DELETE FROM sla_schedule_dates WHERE version_id = ?`).bind(
      version.id,
    ),
  ]);
  await persistSlaSchedule(env, version.id, slaTargets);
  return {
    dates: slaTargets.dates.length,
    stops: slaTargets.stops.length,
    routes: slaTargets.routes.length,
    dryRun: false,
  };
}
