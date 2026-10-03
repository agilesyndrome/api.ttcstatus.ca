import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GENERATOR_VERSION,
  MAP_MODE,
  MAP_STYLE,
  RDP_TOLERANCE_METRES,
  REFERENCE_LATITUDE,
  REFERENCE_LONGITUDE,
  STOP_CLUSTER_METRES,
} from "./config";
import {
  metresBetween,
  projectToLocalMetres,
  simplifyPolyline,
} from "./geometry";
import type { LatLon, MapSourceData, XY } from "./types";
import { layoutStreetcarMap } from "./schematic";

interface StopCluster {
  id: string;
  name: string;
  x: number;
  y: number;
  count: number;
  stopIds: string[];
  routeIds: Set<string>;
  accessible: boolean;
}

/**
 * Build the public Snake map bundle from normalized GTFS + infrastructure.
 * This function is intentionally pure: it does geometry/data shaping only and
 * knows nothing about artifact persistence or activation.
 */
export function buildStreetcarMapBundle(data: MapSourceData, attribution: string): unknown {
  const patternsByShape = new Map<string, typeof data.patterns>();
  for (const pattern of data.patterns) {
    const list = patternsByShape.get(pattern.shape_id) ?? [];
    list.push(pattern);
    patternsByShape.set(pattern.shape_id, list);
  }

  // Project and simplify in metre space. D1 retains the original GTFS shapes;
  // the bundle retains these simplified source coordinates for correspondence.
  const projectedShapes = new Map<string, XY[]>();
  for (const shape of data.shapes) {
    const latLon = JSON.parse(shape.points_json) as LatLon[];
    const projected = simplifyPolyline(latLon.map(projectToLocalMetres), RDP_TOLERANCE_METRES);
    projectedShapes.set(shape.shape_id, projected);
  }

  const projectedOverlays = data.overlays.map((overlay) => {
    const points = simplifyPolyline(
      (JSON.parse(overlay.points_json) as LatLon[]).map(projectToLocalMetres),
      2,
    );
    return { overlay, points };
  });

  const paths = data.shapes.map((shape) => {
    const shapePatterns = patternsByShape.get(shape.shape_id) ?? [];
    return {
      id: `shape:${shape.shape_id}`,
      kind: "scheduled" as const,
      shapeId: shape.shape_id,
      routeIds: [...new Set(shapePatterns.map((pattern) => pattern.route_id))],
      patternIds: shapePatterns.map((pattern) => pattern.pattern_id),
      points: projectedShapes.get(shape.shape_id) ?? [],
    };
  });

  const infrastructure = projectedOverlays.map(({ overlay, points }) => ({
    id: overlay.id,
    name: overlay.name,
    kind: overlay.kind,
    scheduledService: overlay.scheduled_service === 1,
    sourceNote: overlay.source_note,
    verifiedAt: overlay.verified_at,
    points,
  }));

  // Build route membership and ordered stop lists once, then reuse them for both
  // stop clustering and pattern output.
  const routeByPattern = new Map(data.patterns.map((pattern) => [pattern.pattern_id, pattern.route_id]));
  const routesByStop = new Map<string, Set<string>>();
  const stopIdsByPattern = new Map<string, string[]>();
  for (const item of data.patternStops) {
    const routeId = routeByPattern.get(item.pattern_id);
    if (routeId) {
      const routeIds = routesByStop.get(item.stop_id) ?? new Set<string>();
      routeIds.add(routeId);
      routesByStop.set(item.stop_id, routeIds);
    }
    const stopIds = stopIdsByPattern.get(item.pattern_id) ?? [];
    stopIds.push(item.stop_id);
    stopIdsByPattern.set(item.pattern_id, stopIds);
  }

  const clusters: StopCluster[] = [];
  for (const stop of data.stops) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) continue;
    const [x, y] = projectToLocalMetres([stop.lat, stop.lon]);

    // GTFS often contains separate directional/platform records for one visual
    // stop. Cluster only for display; source stop IDs remain attached below.
    let nearest: StopCluster | null = null;
    let nearestDistance = STOP_CLUSTER_METRES;
    for (const cluster of clusters) {
      const distance = metresBetween([x, y], [cluster.x, cluster.y]);
      if (distance <= nearestDistance) {
        nearest = cluster;
        nearestDistance = distance;
      }
    }

    const routeIds = routesByStop.get(stop.stop_id) ?? new Set<string>();
    if (!nearest) {
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
      continue;
    }

    const nextCount = nearest.count + 1;
    nearest.x = (nearest.x * nearest.count + x) / nextCount;
    nearest.y = (nearest.y * nearest.count + y) / nextCount;
    nearest.count = nextCount;
    nearest.stopIds.push(stop.stop_id);
    for (const routeId of routeIds) nearest.routeIds.add(routeId);
    nearest.accessible ||= stop.wheelchair_boarding === 1;
    if (stop.name.length < nearest.name.length) nearest.name = stop.name;
  }

  const stops = clusters.map((cluster) => {
    return {
      id: cluster.id,
      name: cluster.name,
      x: cluster.x,
      y: cluster.y,
      stopIds: cluster.stopIds,
      routeIds: [...cluster.routeIds].sort(),
      accessible: cluster.accessible,
    };
  });

  return layoutStreetcarMap({
    schemaVersion: 1,
    mode: MAP_MODE,
    style: MAP_STYLE,
    generatorVersion: GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    networkVersion: data.version.id,
    source: {
      url: data.version.source_url,
      etag: data.version.source_etag,
      lastModified: data.version.source_last_modified,
      fetchedAt: data.version.fetched_at,
      attribution,
    },
    display: {
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      coordinateSystem: "snake-display-v1",
      sourceProjection: "local-equirectangular-metres",
      reference: { lat: REFERENCE_LATITUDE, lon: REFERENCE_LONGITUDE },
      note: "Canonical geometry is retained alongside the shared schematic graph.",
    },
    routes: data.routes.map((route) => ({
      id: route.route_id,
      shortName: route.short_name,
      longName: route.long_name,
      routeType: route.route_type,
      color: `#${route.color || "D71920"}`,
      textColor: `#${route.text_color || "FFFFFF"}`,
    })),
    patterns: data.patterns.map((pattern) => ({
      id: pattern.pattern_id,
      routeId: pattern.route_id,
      directionId: pattern.direction_id,
      headsign: pattern.headsign,
      pathId: `shape:${pattern.shape_id}`,
      stopIds: stopIdsByPattern.get(pattern.pattern_id) ?? [],
      tripCount: pattern.trip_count,
    })),
    paths,
    stops,
    infrastructure,
  });
}
