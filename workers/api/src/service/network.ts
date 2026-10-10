/** Network bootstrap for the recorder (sla.md story 1.2): the active GTFS
 * version's directional stops (IDs, coordinates, route membership, pattern
 * order) and edges, loaded into the DO and reloaded on version change. Stop
 * IDs are GTFS-stable, so a nightly version flip mid-window loses no touches
 * for unchanged stops (sla.md §4.6 rule 5). */

import type { D1Database } from '../../../shared/cloudflare/bindings';
import { metresBetween, projectToLocalMetres } from '../../../../shared/map/geometry';
import type { ProjectionEdge } from '../../../../shared/map/projection';

export interface NetworkStop {
  /** Directional GTFS stop id — directionality lives here. */
  stopId: string;
  name: string;
  latitude: number;
  longitude: number;
  routes: string[];
  /** Patterns serving this stop; all should agree on direction. */
  patternIds: string[];
  /** 0/1 when the serving patterns agree, null when they don't. */
  directionId: 0 | 1 | null;
  /** Local-metre XY, precomputed for radius checks. */
  local: [number, number];
}

export interface NetworkPattern {
  patternId: string;
  routeId: string;
  directionId: 0 | 1;
  /** Ordered directional stop ids — the space-time diagram's x-axis. */
  stopIds: string[];
  edgeId: string;
}

export interface RecorderNetwork {
  versionId: number;
  stops: Map<string, NetworkStop>;
  /** routeId → directional stop ids serving that route. */
  stopsByRoute: Map<string, string[]>;
  patterns: Map<string, NetworkPattern>;
  /** All matching edges (one per pattern, built from its shape). */
  edges: ProjectionEdge[];
  /** routeId → edges for that route (matchGpsToTrack candidates). */
  edgesByRoute: Map<string, ProjectionEdge[]>;
}

const SOURCE_KEY = 'ttc-surface-gtfs';

export async function activeNetworkVersionId(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT id FROM network_versions WHERE source_key = ? AND active = 1 ORDER BY id DESC LIMIT 1`,
    )
    .bind(SOURCE_KEY)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Load the active version's network. Everything the recorder matches
 * against is here; nothing else in the recorder touches D1 for network data. */
export async function loadNetwork(db: D1Database): Promise<RecorderNetwork> {
  const versionId = await activeNetworkVersionId(db);
  if (versionId === null) throw new Error('No active network version.');

  const patternRows = (
    await db
      .prepare(
        `SELECT pattern_id, route_id, direction_id, shape_id
         FROM gtfs_patterns WHERE version_id = ?`,
      )
      .bind(versionId)
      .all()
  ).results as Array<{
    pattern_id: string;
    route_id: string;
    direction_id: number;
    shape_id: string;
  }>;
  const shapeRows = (
    await db
      .prepare(`SELECT shape_id, points_json FROM gtfs_shapes WHERE version_id = ?`)
      .bind(versionId)
      .all()
  ).results as Array<{ shape_id: string; points_json: string }>;
  const stopRows = (
    await db
      .prepare(`SELECT stop_id, name, lat, lon FROM gtfs_stops WHERE version_id = ?`)
      .bind(versionId)
      .all()
  ).results as Array<{ stop_id: string; name: string; lat: number; lon: number }>;
  const patternStopRows = (
    await db
      .prepare(
        `SELECT pattern_id, stop_id, stop_sequence FROM gtfs_pattern_stops
         WHERE version_id = ? ORDER BY pattern_id, stop_sequence`,
      )
      .bind(versionId)
      .all()
  ).results as Array<{ pattern_id: string; stop_id: string; stop_sequence: number }>;

  const shapes = new Map(
    shapeRows.map((row) => [
      row.shape_id,
      JSON.parse(row.points_json) as Array<[number, number]>,
    ]),
  );
  const stops = new Map<string, NetworkStop>();
  for (const row of stopRows) {
    stops.set(row.stop_id, {
      stopId: row.stop_id,
      name: row.name,
      latitude: row.lat,
      longitude: row.lon,
      routes: [],
      patternIds: [],
      directionId: null,
      local: projectToLocalMetres([row.lat, row.lon]),
    });
  }
  const stopsByRoute = new Map<string, string[]>();
  const patterns = new Map<string, NetworkPattern>();
  const edges: ProjectionEdge[] = [];
  const patternStopsByPattern = new Map<
    string,
    Array<{ stop_id: string; stop_sequence: number }>
  >();
  for (const row of patternStopRows) {
    const bucket = patternStopsByPattern.get(row.pattern_id) ?? [];
    bucket.push(row);
    patternStopsByPattern.set(row.pattern_id, bucket);
  }
  for (const pattern of patternRows) {
    const ordered = (patternStopsByPattern.get(pattern.pattern_id) ?? []).sort(
      (a, b) => a.stop_sequence - b.stop_sequence,
    );
    const directionId: 0 | 1 = pattern.direction_id === 1 ? 1 : 0;
    const edgeId = `edge:${pattern.pattern_id}`;
    patterns.set(pattern.pattern_id, {
      patternId: pattern.pattern_id,
      routeId: pattern.route_id,
      directionId,
      stopIds: ordered.map((entry) => entry.stop_id),
      edgeId,
    });
    edges.push(buildEdge(edgeId, shapes.get(pattern.shape_id) ?? [], pattern.route_id));
    for (const entry of ordered) {
      const stop = stops.get(entry.stop_id);
      if (!stop) continue;
      stop.patternIds.push(pattern.pattern_id);
      if (!stop.routes.includes(pattern.route_id)) stop.routes.push(pattern.route_id);
      stop.directionId =
        stop.directionId === null || stop.directionId === directionId
          ? directionId
          : null;
      const routeStops = stopsByRoute.get(pattern.route_id) ?? [];
      if (!routeStops.includes(entry.stop_id)) {
        routeStops.push(entry.stop_id);
        stopsByRoute.set(pattern.route_id, routeStops);
      }
    }
  }
  const edgesByRoute = new Map<string, ProjectionEdge[]>();
  for (const pattern of patterns.values()) {
    const bucket = edgesByRoute.get(pattern.routeId) ?? [];
    bucket.push(...edges.filter((edge) => edge.id === pattern.edgeId));
    edgesByRoute.set(pattern.routeId, bucket);
  }
  return { versionId, stops, stopsByRoute, patterns, edges, edgesByRoute };
}

/** One pattern's shape → one matching edge in local-metre space (the same
 * space matchGpsToTrack works in without a display transform). */
function buildEdge(
  edgeId: string,
  points: Array<[number, number]>,
  routeId: string,
): ProjectionEdge {
  const sourcePoints = points.map((point) => projectToLocalMetres([point[0], point[1]]));
  const sourceDistances: number[] = [];
  let total = 0;
  for (let index = 1; index < sourcePoints.length; index += 1) {
    total += metresBetween(sourcePoints[index - 1], sourcePoints[index]);
    sourceDistances.push(total);
  }
  return {
    id: edgeId,
    a: `${edgeId}:a`,
    b: `${edgeId}:b`,
    routeIds: [routeId],
    sourcePoints,
    points: sourcePoints,
    sourceDistances: [0, ...sourceDistances],
    lengthMetres: total,
  };
}
