import type { D1Database } from "../../shared/cloudflare";
import { parseStreetcarGtfs, type ParsedStreetcarGtfs } from "../../shared/gtfs";
import { R2ZipArchive } from "../../shared/zip";
import {
  BATCH_SIZE,
  SOURCE_KEY,
  ensureState,
  nowIso,
  runBatches,
  type NetworkVersion,
  type SyncEnv,
  type SyncResult,
} from "./sync-common";

async function clearVersionRows(env: SyncEnv, versionId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM gtfs_pattern_stops WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_stops WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_shapes WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_patterns WHERE version_id = ?`).bind(versionId),
    env.DB.prepare(`DELETE FROM gtfs_routes WHERE version_id = ?`).bind(versionId),
  ]);
}

async function importNormalized(
  env: SyncEnv,
  versionId: number,
  parsed: ParsedStreetcarGtfs,
): Promise<void> {
  await clearVersionRows(env, versionId);

  await runBatches(env, parsed.routes.map((route) => env.DB.prepare(
    `INSERT INTO gtfs_routes (
       version_id, route_id, short_name, long_name, route_type, color, text_color, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    versionId,
    route.routeId,
    route.shortName,
    route.longName,
    route.routeType,
    route.color,
    route.textColor,
    route.rowHash,
  )));

  await runBatches(env, parsed.patterns.map((pattern) => env.DB.prepare(
    `INSERT INTO gtfs_patterns (
       version_id, pattern_id, route_id, direction_id, shape_id, headsign,
       representative_trip_id, trip_count, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  )));

  await runBatches(env, parsed.shapes.map((shape) => env.DB.prepare(
    `INSERT INTO gtfs_shapes (
       version_id, shape_id, points_json, point_count, row_hash
     ) VALUES (?, ?, ?, ?, ?)`
  ).bind(
    versionId,
    shape.shapeId,
    JSON.stringify(shape.points),
    shape.points.length,
    shape.rowHash,
  )));

  await runBatches(env, parsed.stops.map((stop) => env.DB.prepare(
    `INSERT INTO gtfs_stops (
       version_id, stop_id, name, lat, lon, location_type, parent_station,
       wheelchair_boarding, row_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  )));

  await runBatches(env, parsed.patternStops.map((stop) => env.DB.prepare(
    `INSERT INTO gtfs_pattern_stops (
       version_id, pattern_id, stop_id, stop_sequence, row_hash
     ) VALUES (?, ?, ?, ?, ?)`
  ).bind(
    versionId,
    stop.patternId,
    stop.stopId,
    stop.sequence,
    stop.rowHash,
  )));
}

function validateImport(parsed: ParsedStreetcarGtfs): void {
  const { stats } = parsed;
  if (stats.routeCount < 8) throw new Error(`Streetcar import sanity check failed: only ${stats.routeCount} routes`);
  if (stats.patternCount < stats.routeCount) throw new Error("Streetcar import sanity check failed: too few patterns");
  if (stats.shapeCount < stats.routeCount) throw new Error("Streetcar import sanity check failed: too few shapes");
  if (stats.stopCount < 50) throw new Error(`Streetcar import sanity check failed: only ${stats.stopCount} stops`);
  if (stats.patternStopCount < stats.stopCount) throw new Error("Streetcar import sanity check failed: too few pattern-stop rows");
}

async function tableDelta(
  env: SyncEnv,
  table: string,
  key: string,
  fromVersionId: number,
  toVersionId: number,
): Promise<{ added: number; removed: number; changed: number }> {
  // Table/key are internal constants supplied below, never request input.
  const row = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM ${table} n
        LEFT JOIN ${table} o ON o.version_id = ? AND o.${key} = n.${key}
        WHERE n.version_id = ? AND o.${key} IS NULL) AS added,
      (SELECT COUNT(*) FROM ${table} o
        LEFT JOIN ${table} n ON n.version_id = ? AND n.${key} = o.${key}
        WHERE o.version_id = ? AND n.${key} IS NULL) AS removed,
      (SELECT COUNT(*) FROM ${table} n
        JOIN ${table} o ON o.version_id = ? AND o.${key} = n.${key}
        WHERE n.version_id = ? AND n.row_hash <> o.row_hash) AS changed`
  ).bind(
    fromVersionId, toVersionId,
    toVersionId, fromVersionId,
    fromVersionId, toVersionId,
  ).first<{ added: number; removed: number; changed: number }>();
  return row ?? { added: 0, removed: 0, changed: 0 };
}

async function recordDelta(
  env: SyncEnv,
  fromVersionId: number | null,
  toVersionId: number,
): Promise<void> {
  let summary: Record<string, unknown>;
  if (fromVersionId == null) {
    const version = await env.DB.prepare(
      `SELECT route_count, pattern_count, shape_count, stop_count, pattern_stop_count
       FROM network_versions WHERE id = ?`
    ).bind(toVersionId).first<Record<string, unknown>>();
    summary = { initialImport: true, counts: version ?? {} };
  } else {
    summary = {
      routes: await tableDelta(env, "gtfs_routes", "route_id", fromVersionId, toVersionId),
      patterns: await tableDelta(env, "gtfs_patterns", "pattern_id", fromVersionId, toVersionId),
      shapes: await tableDelta(env, "gtfs_shapes", "shape_id", fromVersionId, toVersionId),
      stops: await tableDelta(env, "gtfs_stops", "stop_id", fromVersionId, toVersionId),
    };
  }

  await env.DB.prepare(
    `INSERT OR REPLACE INTO feed_change_events (
       source_key, from_version_id, to_version_id, created_at, summary_json
     ) VALUES (?, ?, ?, ?, ?)`
  ).bind(
    SOURCE_KEY,
    fromVersionId,
    toVersionId,
    nowIso(),
    JSON.stringify(summary),
  ).run();
}

async function requestMapGeneration(env: SyncEnv, versionId: number): Promise<number> {
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO map_generation_jobs (version_id, mode, generator, status, created_at)
     VALUES (?, 'streetcar', 'snake-v1', 'pending', ?)`
  ).bind(versionId, createdAt).run();

  const response = await env.MAP_GENERATOR.fetch("https://map-generator.internal/internal/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ versionId, mode: "streetcar", style: "snake-v1" }),
  });

  const payload = await response.json().catch(() => ({})) as { artifactId?: number; error?: string };
  if (!response.ok || !payload.artifactId) {
    throw new Error(payload.error || `Map generator returned HTTP ${response.status}`);
  }
  return payload.artifactId;
}

async function activateVersion(
  env: SyncEnv,
  version: NetworkVersion,
  artifactId: number,
): Promise<void> {
  const activatedAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE network_versions SET active = 0
       WHERE source_key = ? AND active = 1`
    ).bind(SOURCE_KEY),
    env.DB.prepare(
      `UPDATE map_artifacts SET active = 0
       WHERE mode = 'streetcar' AND style = 'snake-v1' AND active = 1`
    ),
    env.DB.prepare(
      `UPDATE network_versions
       SET active = 1, status = 'active', error = NULL, activated_at = ?
       WHERE id = ?`
    ).bind(activatedAt, version.id),
    env.DB.prepare(
      `UPDATE map_artifacts SET active = 1 WHERE id = ?`
    ).bind(artifactId),
    env.DB.prepare(
      `UPDATE source_state
       SET source_url = ?, source_etag = ?, source_last_modified = ?,
           source_content_length = ?, r2_etag = ?, r2_key = ?, active_version_id = ?,
           last_checked_at = ?, last_changed_at = ?, last_error = NULL
       WHERE source_key = ?`
    ).bind(
      version.source_url,
      version.source_etag,
      version.source_last_modified,
      version.source_content_length,
      version.r2_etag,
      version.r2_key,
      version.id,
      activatedAt,
      activatedAt,
      SOURCE_KEY,
    ),
  ]);
}

async function pruneOldMaterializedVersions(env: SyncEnv): Promise<void> {
  const versions = (await env.DB.prepare(
    `SELECT id, r2_key, raw_retained
     FROM network_versions
     WHERE source_key = ?
     ORDER BY id DESC`
  ).bind(SOURCE_KEY).all<{ id: number; r2_key: string; raw_retained: number }>()).results;

  for (const version of versions.slice(2)) {
    if (version.raw_retained === 1) {
      await env.GTFS_BUCKET.delete(version.r2_key);
      await env.DB.prepare(
        `UPDATE network_versions SET raw_retained = 0 WHERE id = ?`
      ).bind(version.id).run();
    }

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM map_artifact_chunks
         WHERE artifact_id IN (SELECT id FROM map_artifacts WHERE version_id = ?)`
      ).bind(version.id),
      env.DB.prepare(`DELETE FROM map_artifacts WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_pattern_stops WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_stops WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_shapes WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_patterns WHERE version_id = ?`).bind(version.id),
      env.DB.prepare(`DELETE FROM gtfs_routes WHERE version_id = ?`).bind(version.id),
    ]);
  }

}

export async function processVersion(env: SyncEnv, version: NetworkVersion): Promise<SyncResult> {
  const previousVersionId = (await ensureState(env)).active_version_id;

  try {
    if (["downloaded", "failed_import", "importing"].includes(version.status)) {
      await env.DB.prepare(
        `UPDATE network_versions SET status = 'importing', error = NULL WHERE id = ?`
      ).bind(version.id).run();

      const archive = await R2ZipArchive.open(env.GTFS_BUCKET, version.r2_key);
      const parsed = await parseStreetcarGtfs(archive);
      validateImport(parsed);
      await importNormalized(env, version.id, parsed);

      await env.DB.prepare(
        `UPDATE network_versions
         SET status = 'imported', error = NULL, imported_at = ?,
             route_count = ?, pattern_count = ?, shape_count = ?, stop_count = ?, pattern_stop_count = ?
         WHERE id = ?`
      ).bind(
        nowIso(),
        parsed.stats.routeCount,
        parsed.stats.patternCount,
        parsed.stats.shapeCount,
        parsed.stats.stopCount,
        parsed.stats.patternStopCount,
        version.id,
      ).run();
      version.status = "imported";
    }

    await env.DB.prepare(
      `UPDATE network_versions SET status = 'generating_map', error = NULL WHERE id = ?`
    ).bind(version.id).run();
    version.status = "generating_map";

    const artifactId = await requestMapGeneration(env, version.id);
    await recordDelta(env, previousVersionId, version.id);
    await activateVersion(env, version, artifactId);
    await pruneOldMaterializedVersions(env);

    return {
      status: "updated",
      reason: "new-static-gtfs-activated",
      versionId: version.id,
      sourceCheckedAt: nowIso(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = version.status === "generating_map" ? "map_failed" : "failed_import";
    await env.DB.prepare(
      `UPDATE network_versions SET status = ?, error = ? WHERE id = ?`
    ).bind(status, message.slice(0, 2000), version.id).run();
    throw error;
  }
}
