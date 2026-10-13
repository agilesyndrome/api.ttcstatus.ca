import type {
  MapGeneratorEnv,
  MapSourceData,
  OverlayRow,
  PatternRow,
  PatternStopRow,
  RouteRow,
  ShapeRow,
  StopRow,
  VersionRow,
} from '../types';

/** Read one already-normalized static network version from D1. */
export async function loadMapSourceData(
  env: MapGeneratorEnv,
  versionId: number,
): Promise<MapSourceData> {
  const version = await env.DB.prepare(
    `SELECT * FROM network_versions WHERE id = ? LIMIT 1`,
  )
    .bind(versionId)
    .first<VersionRow>();

  if (!version) throw new Error(`Network version ${versionId} not found`);
  if (!version.imported_at) {
    throw new Error(`Network version ${versionId} has not completed static import`);
  }

  const [routes, patterns, shapes, stops, patternStops, overlays] = await Promise.all([
    env.DB.prepare(
      `SELECT route_id, short_name, long_name, route_type, color, text_color
       FROM gtfs_routes WHERE version_id = ? ORDER BY short_name`,
    )
      .bind(versionId)
      .all<RouteRow>(),
    env.DB.prepare(
      `SELECT pattern_id, route_id, direction_id, shape_id, headsign, trip_count
       FROM gtfs_patterns WHERE version_id = ? ORDER BY route_id, direction_id, pattern_id`,
    )
      .bind(versionId)
      .all<PatternRow>(),
    env.DB.prepare(
      `SELECT shape_id, points_json
       FROM gtfs_shapes WHERE version_id = ? ORDER BY shape_id`,
    )
      .bind(versionId)
      .all<ShapeRow>(),
    env.DB.prepare(
      `SELECT stop_id, name, lat, lon, location_type, parent_station, wheelchair_boarding
       FROM gtfs_stops WHERE version_id = ? ORDER BY stop_id`,
    )
      .bind(versionId)
      .all<StopRow>(),
    env.DB.prepare(
      `SELECT pattern_id, stop_id, stop_sequence
       FROM gtfs_pattern_stops WHERE version_id = ? ORDER BY pattern_id, stop_sequence`,
    )
      .bind(versionId)
      .all<PatternStopRow>(),
    env.DB.prepare(
      `SELECT id, name, kind, scheduled_service, points_json, source_note, verified_at
       FROM infrastructure_overlays
       WHERE mode = 'streetcar' AND enabled = 1 ORDER BY id`,
    ).all<OverlayRow>(),
  ]);

  const data: MapSourceData = {
    version,
    routes: routes.results,
    patterns: patterns.results,
    shapes: shapes.results,
    stops: stops.results,
    patternStops: patternStops.results,
    overlays: overlays.results,
  };

  if (!data.routes.length || !data.patterns.length || !data.shapes.length) {
    throw new Error(`Network version ${versionId} is missing route/pattern/shape data`);
  }
  return data;
}
