import {
  parseStreetcarGtfs,
  type ParsedStreetcarGtfs,
} from '../../../shared/gtfs/parser';
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
  if (/completegtfs\.zip/i.test(env.STATIC_GTFS_URL)) {
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
  await persistNormalizedGtfs(env, version.id, parsed);

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
