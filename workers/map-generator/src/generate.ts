import type { D1Database } from "../../shared/cloudflare";
import { sha256Hex } from "../../shared/hash";

const GENERATOR_VERSION = "snake-v1.0.0";
const STYLE = "snake-v1";
const MODE = "streetcar";
const WIDTH = 1600;
const HEIGHT = 1100;
const PADDING = 70;
const RDP_TOLERANCE_METRES = 18;
const STOP_CLUSTER_METRES = 34;
const CHUNK_CHARACTERS = 300_000;
const REF_LAT = 43.65;
const REF_LON = -79.38;

export interface MapGeneratorEnv {
  DB: D1Database;
  SOURCE_ATTRIBUTION: string;
}

interface VersionRow {
  id: number;
  source_url: string;
  source_etag: string | null;
  source_last_modified: string | null;
  fetched_at: string;
  imported_at: string | null;
  route_count: number;
  pattern_count: number;
  shape_count: number;
  stop_count: number;
}

interface RouteRow {
  route_id: string;
  short_name: string;
  long_name: string;
  route_type: number;
  color: string;
  text_color: string;
}

interface PatternRow {
  pattern_id: string;
  route_id: string;
  direction_id: number;
  shape_id: string;
  headsign: string;
  trip_count: number;
}

interface ShapeRow {
  shape_id: string;
  points_json: string;
}

interface StopRow {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  location_type: number;
  parent_station: string;
  wheelchair_boarding: number;
}

interface PatternStopRow {
  pattern_id: string;
  stop_id: string;
  stop_sequence: number;
}

interface OverlayRow {
  id: string;
  name: string;
  kind: string;
  scheduled_service: number;
  points_json: string;
  source_note: string;
  verified_at: string | null;
}

type LatLon = [number, number];
type XY = [number, number];

function project([lat, lon]: LatLon): XY {
  const radians = Math.PI / 180;
  const metresPerLonDegree = 111_320 * Math.cos(REF_LAT * radians);
  const metresPerLatDegree = 110_540;
  return [(lon - REF_LON) * metresPerLonDegree, (lat - REF_LAT) * metresPerLatDegree];
}

function squaredDistanceToSegment(point: XY, a: XY, b: XY): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const denom = vx * vx + vy * vy;
  if (denom === 0) {
    const dx = point[0] - a[0];
    const dy = point[1] - a[1];
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / denom));
  const px = a[0] + t * vx;
  const py = a[1] + t * vy;
  const dx = point[0] - px;
  const dy = point[1] - py;
  return dx * dx + dy * dy;
}

function rdp(points: XY[], tolerance: number): XY[] {
  if (points.length <= 2) return points;
  const threshold = tolerance * tolerance;

  const simplify = (start: number, end: number, keep: Set<number>) => {
    let maxDistance = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = squaredDistanceToSegment(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index > start && maxDistance > threshold) {
      keep.add(index);
      simplify(start, index, keep);
      simplify(index, end, keep);
    }
  };

  const keep = new Set<number>([0, points.length - 1]);
  simplify(0, points.length - 1, keep);
  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

function metresBetween(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function bounds(all: XY[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (!all.length) throw new Error("Map generator has no geometry to bound");
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of all) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function displayTransform(box: ReturnType<typeof bounds>) {
  const spanX = Math.max(1, box.maxX - box.minX);
  const spanY = Math.max(1, box.maxY - box.minY);
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const xOffset = (WIDTH - usedWidth) / 2;
  const yOffset = (HEIGHT - usedHeight) / 2;

  return (point: XY): XY => [
    Math.round((xOffset + (point[0] - box.minX) * scale) * 10) / 10,
    Math.round((HEIGHT - yOffset - (point[1] - box.minY) * scale) * 10) / 10,
  ];
}

function chunkString(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + CHUNK_CHARACTERS);
    // Do not split a UTF-16 surrogate pair across D1 rows.
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

export async function generateStreetcarMap(env: MapGeneratorEnv, versionId: number): Promise<number> {
  const version = await env.DB.prepare(
    `SELECT * FROM network_versions WHERE id = ? LIMIT 1`
  ).bind(versionId).first<VersionRow>();
  if (!version) throw new Error(`Network version ${versionId} not found`);
  if (!version.imported_at) throw new Error(`Network version ${versionId} has not completed static import`);

  const [routesResult, patternsResult, shapesResult, stopsResult, patternStopsResult, overlaysResult] = await Promise.all([
    env.DB.prepare(`SELECT route_id, short_name, long_name, route_type, color, text_color FROM gtfs_routes WHERE version_id = ? ORDER BY short_name`).bind(versionId).all<RouteRow>(),
    env.DB.prepare(`SELECT pattern_id, route_id, direction_id, shape_id, headsign, trip_count FROM gtfs_patterns WHERE version_id = ? ORDER BY route_id, direction_id, pattern_id`).bind(versionId).all<PatternRow>(),
    env.DB.prepare(`SELECT shape_id, points_json FROM gtfs_shapes WHERE version_id = ? ORDER BY shape_id`).bind(versionId).all<ShapeRow>(),
    env.DB.prepare(`SELECT stop_id, name, lat, lon, location_type, parent_station, wheelchair_boarding FROM gtfs_stops WHERE version_id = ? ORDER BY stop_id`).bind(versionId).all<StopRow>(),
    env.DB.prepare(`SELECT pattern_id, stop_id, stop_sequence FROM gtfs_pattern_stops WHERE version_id = ? ORDER BY pattern_id, stop_sequence`).bind(versionId).all<PatternStopRow>(),
    env.DB.prepare(`SELECT id, name, kind, scheduled_service, points_json, source_note, verified_at FROM infrastructure_overlays WHERE mode = 'streetcar' AND enabled = 1 ORDER BY id`).all<OverlayRow>(),
  ]);

  const routes = routesResult.results;
  const patterns = patternsResult.results;
  const shapes = shapesResult.results;
  const stops = stopsResult.results;
  const patternStops = patternStopsResult.results;
  const overlays = overlaysResult.results;

  if (!routes.length || !patterns.length || !shapes.length) {
    throw new Error(`Network version ${versionId} is missing route/pattern/shape data`);
  }

  const patternsByShape = new Map<string, PatternRow[]>();
  for (const pattern of patterns) {
    const list = patternsByShape.get(pattern.shape_id) ?? [];
    list.push(pattern);
    patternsByShape.set(pattern.shape_id, list);
  }

  const projectedShapes = new Map<string, XY[]>();
  const allProjected: XY[] = [];
  for (const shape of shapes) {
    const latLon = JSON.parse(shape.points_json) as LatLon[];
    const projected = rdp(latLon.map(project), RDP_TOLERANCE_METRES);
    projectedShapes.set(shape.shape_id, projected);
    allProjected.push(...projected);
  }

  const projectedOverlays = overlays.map((overlay) => {
    const points = rdp((JSON.parse(overlay.points_json) as LatLon[]).map(project), 2);
    allProjected.push(...points);
    return { overlay, points };
  });

  const transform = displayTransform(bounds(allProjected));

  const paths = shapes.map((shape) => {
    const shapePatterns = patternsByShape.get(shape.shape_id) ?? [];
    const routeIds = [...new Set(shapePatterns.map((pattern) => pattern.route_id))];
    return {
      id: `shape:${shape.shape_id}`,
      kind: "scheduled" as const,
      shapeId: shape.shape_id,
      routeIds,
      patternIds: shapePatterns.map((pattern) => pattern.pattern_id),
      points: (projectedShapes.get(shape.shape_id) ?? []).map(transform),
    };
  });

  const infrastructure = projectedOverlays.map(({ overlay, points }) => ({
    id: overlay.id,
    name: overlay.name,
    kind: overlay.kind,
    scheduledService: overlay.scheduled_service === 1,
    sourceNote: overlay.source_note,
    verifiedAt: overlay.verified_at,
    points: points.map(transform),
  }));

  const patternRoute = new Map(patterns.map((pattern) => [pattern.pattern_id, pattern.route_id]));
  const routesByStop = new Map<string, Set<string>>();
  const patternStopIds = new Map<string, string[]>();
  for (const item of patternStops) {
    const routeId = patternRoute.get(item.pattern_id);
    if (routeId) {
      const set = routesByStop.get(item.stop_id) ?? new Set<string>();
      set.add(routeId);
      routesByStop.set(item.stop_id, set);
    }
    const list = patternStopIds.get(item.pattern_id) ?? [];
    list.push(item.stop_id);
    patternStopIds.set(item.pattern_id, list);
  }

  type Cluster = {
    id: string;
    name: string;
    x: number;
    y: number;
    count: number;
    stopIds: string[];
    routeIds: Set<string>;
    accessible: boolean;
  };
  const clusters: Cluster[] = [];

  for (const stop of stops) {
    // Platform children are useful, but station parent records without useful
    // coordinates can create duplicate labels. Only cluster rows with finite coords.
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    const [x, y] = project([stop.lat, stop.lon]);
    let best: Cluster | null = null;
    let bestDistance = STOP_CLUSTER_METRES;
    for (const cluster of clusters) {
      const distance = metresBetween([x, y], [cluster.x, cluster.y]);
      if (distance <= bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }

    const routeIds = routesByStop.get(stop.stop_id) ?? new Set<string>();
    if (!best) {
      clusters.push({
        id: `stop:${stop.stop_id}`,
        name: stop.name,
        x,
        y,
        count: 1,
        stopIds: [stop.stop_id],
        routeIds: new Set(routeIds),
        accessible: stop.wheelchair_boarding === 1,
      });
    } else {
      const nextCount = best.count + 1;
      best.x = (best.x * best.count + x) / nextCount;
      best.y = (best.y * best.count + y) / nextCount;
      best.count = nextCount;
      best.stopIds.push(stop.stop_id);
      for (const routeId of routeIds) best.routeIds.add(routeId);
      best.accessible ||= stop.wheelchair_boarding === 1;
      // Prefer a shorter directional/platform-free label when available.
      if (stop.name.length < best.name.length) best.name = stop.name;
    }
  }

  const displayStops = clusters.map((cluster) => {
    const [x, y] = transform([cluster.x, cluster.y]);
    return {
      id: cluster.id,
      name: cluster.name,
      x,
      y,
      stopIds: cluster.stopIds,
      routeIds: [...cluster.routeIds].sort(),
      accessible: cluster.accessible,
    };
  });

  const displayPatterns = patterns.map((pattern) => ({
    id: pattern.pattern_id,
    routeId: pattern.route_id,
    directionId: pattern.direction_id,
    headsign: pattern.headsign,
    pathId: `shape:${pattern.shape_id}`,
    stopIds: patternStopIds.get(pattern.pattern_id) ?? [],
    tripCount: pattern.trip_count,
  }));

  const artifact = {
    schemaVersion: 1,
    mode: MODE,
    style: STYLE,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    networkVersion: version.id,
    source: {
      url: version.source_url,
      etag: version.source_etag,
      lastModified: version.source_last_modified,
      fetchedAt: version.fetched_at,
      attribution: env.SOURCE_ATTRIBUTION,
    },
    display: {
      width: WIDTH,
      height: HEIGHT,
      coordinateSystem: "snake-display-v1",
      sourceProjection: "local-equirectangular-metres",
      reference: { lat: REF_LAT, lon: REF_LON },
      note: "Geometry is pre-simplified for display. Topology-aware schematic optimization will replace this seed generator without changing the public bundle contract.",
    },
    routes: routes.map((route) => ({
      id: route.route_id,
      shortName: route.short_name,
      longName: route.long_name,
      routeType: route.route_type,
      color: `#${route.color || "D71920"}`,
      textColor: `#${route.text_color || "FFFFFF"}`,
    })),
    patterns: displayPatterns,
    paths,
    stops: displayStops,
    infrastructure,
  };

  const json = JSON.stringify(artifact);
  const etag = await sha256Hex(json);
  const chunks = chunkString(json);
  const createdAt = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT id FROM map_artifacts
     WHERE version_id = ? AND mode = ? AND style = ? AND generator_version = ?
     LIMIT 1`
  ).bind(versionId, MODE, STYLE, GENERATOR_VERSION).first<{ id: number }>();

  let artifactId: number;
  if (existing) {
    artifactId = existing.id;
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM map_artifact_chunks WHERE artifact_id = ?`).bind(artifactId),
      env.DB.prepare(
        `UPDATE map_artifacts
         SET etag = ?, byte_size = ?, chunk_count = ?, created_at = ?
         WHERE id = ?`
      ).bind(etag, new TextEncoder().encode(json).byteLength, chunks.length, createdAt, artifactId),
    ]);
  } else {
    await env.DB.prepare(
      `INSERT INTO map_artifacts (
         version_id, mode, style, generator_version, etag, byte_size, chunk_count, created_at, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(
      versionId,
      MODE,
      STYLE,
      GENERATOR_VERSION,
      etag,
      new TextEncoder().encode(json).byteLength,
      chunks.length,
      createdAt,
    ).run();
    const inserted = await env.DB.prepare(
      `SELECT id FROM map_artifacts
       WHERE version_id = ? AND mode = ? AND style = ? AND generator_version = ?
       LIMIT 1`
    ).bind(versionId, MODE, STYLE, GENERATOR_VERSION).first<{ id: number }>();
    if (!inserted) throw new Error("Map artifact insert succeeded but could not be read back");
    artifactId = inserted.id;
  }

  const statements = chunks.map((payload, index) => env.DB.prepare(
    `INSERT INTO map_artifact_chunks (artifact_id, chunk_index, payload)
     VALUES (?, ?, ?)`
  ).bind(artifactId, index, payload));
  for (let i = 0; i < statements.length; i += 25) {
    await env.DB.batch(statements.slice(i, i + 25));
  }

  await env.DB.prepare(
    `UPDATE map_generation_jobs
     SET status = 'completed', completed_at = ?, error = NULL
     WHERE id = (
       SELECT id FROM map_generation_jobs
       WHERE version_id = ? AND mode = ?
       ORDER BY id DESC LIMIT 1
     )`
  ).bind(createdAt, versionId, MODE).run();

  return artifactId;
}
