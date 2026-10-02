import { csvRows } from "./csv";
import { fnv1a } from "./hash";
import type {
  PatternRecord,
  PatternStopRecord,
  RouteRecord,
  ShapeRecord,
  StopRecord,
} from "./models";
import { R2ZipArchive } from "./zip";

const STREETCAR_ROUTE_TYPE = 0;

function number(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function patternKey(routeId: string, directionId: number, shapeId: string, headsign: string): string {
  return `${routeId}|${directionId}|${shapeId}|${headsign}`;
}

export interface ParsedStreetcarGtfs {
  routes: RouteRecord[];
  patterns: PatternRecord[];
  shapes: ShapeRecord[];
  stops: StopRecord[];
  patternStops: PatternStopRecord[];
  stats: {
    routeCount: number;
    patternCount: number;
    shapeCount: number;
    stopCount: number;
    patternStopCount: number;
  };
}

export async function parseStreetcarGtfs(archive: R2ZipArchive): Promise<ParsedStreetcarGtfs> {
  const routes: RouteRecord[] = [];
  const streetcarRouteIds = new Set<string>();

  for await (const row of csvRows(await archive.stream("routes.txt"))) {
    const routeType = number(row.route_type, -1);
    if (routeType !== STREETCAR_ROUTE_TYPE) continue;
    const record: RouteRecord = {
      routeId: row.route_id,
      shortName: row.route_short_name,
      longName: row.route_long_name,
      routeType,
      color: row.route_color || "D71920",
      textColor: row.route_text_color || "FFFFFF",
      rowHash: "",
    };
    record.rowHash = fnv1a(JSON.stringify(record));
    routes.push(record);
    streetcarRouteIds.add(record.routeId);
  }

  if (routes.length === 0) throw new Error("GTFS import found no route_type=0 streetcar routes");

  type PatternAccumulator = {
    routeId: string;
    directionId: number;
    shapeId: string;
    headsign: string;
    representativeTripId: string;
    tripCount: number;
  };
  const accumulators = new Map<string, PatternAccumulator>();

  for await (const row of csvRows(await archive.stream("trips.txt"))) {
    if (!streetcarRouteIds.has(row.route_id) || !row.shape_id) continue;
    const directionId = number(row.direction_id, 0);
    const headsign = row.trip_headsign || "";
    const key = patternKey(row.route_id, directionId, row.shape_id, headsign);
    const existing = accumulators.get(key);
    if (existing) {
      existing.tripCount++;
    } else {
      accumulators.set(key, {
        routeId: row.route_id,
        directionId,
        shapeId: row.shape_id,
        headsign,
        representativeTripId: row.trip_id,
        tripCount: 1,
      });
    }
  }

  const patterns: PatternRecord[] = [...accumulators.values()].map((value) => {
    const patternId = `p_${fnv1a(patternKey(value.routeId, value.directionId, value.shapeId, value.headsign))}`;
    const record: PatternRecord = {
      patternId,
      routeId: value.routeId,
      directionId: value.directionId,
      shapeId: value.shapeId,
      headsign: value.headsign,
      representativeTripId: value.representativeTripId,
      tripCount: value.tripCount,
      rowHash: "",
    };
    record.rowHash = fnv1a(JSON.stringify(record));
    return record;
  });

  if (patterns.length === 0) throw new Error("GTFS import found no streetcar trip patterns");

  const wantedShapeIds = new Set(patterns.map((pattern) => pattern.shapeId));
  const shapePoints = new Map<string, Array<{ sequence: number; lat: number; lon: number }>>();

  for await (const row of csvRows(await archive.stream("shapes.txt"))) {
    if (!wantedShapeIds.has(row.shape_id)) continue;
    const list = shapePoints.get(row.shape_id) ?? [];
    list.push({
      sequence: number(row.shape_pt_sequence),
      lat: number(row.shape_pt_lat),
      lon: number(row.shape_pt_lon),
    });
    shapePoints.set(row.shape_id, list);
  }

  const shapes: ShapeRecord[] = [];
  for (const [shapeId, raw] of shapePoints) {
    raw.sort((a, b) => a.sequence - b.sequence);
    const points = raw.map(({ lat, lon }) => [lat, lon] as [number, number]);
    const record: ShapeRecord = { shapeId, points, rowHash: fnv1a(JSON.stringify(points)) };
    shapes.push(record);
  }

  const tripToPattern = new Map(patterns.map((pattern) => [pattern.representativeTripId, pattern.patternId]));
  const wantedStopIds = new Set<string>();
  const patternStops: PatternStopRecord[] = [];

  for await (const row of csvRows(await archive.stream("stop_times.txt"))) {
    const patternId = tripToPattern.get(row.trip_id);
    if (!patternId) continue;
    const stopId = row.stop_id;
    const sequence = number(row.stop_sequence);
    wantedStopIds.add(stopId);
    patternStops.push({
      patternId,
      stopId,
      sequence,
      rowHash: fnv1a(`${patternId}|${stopId}|${sequence}`),
    });
  }

  const stops: StopRecord[] = [];
  for await (const row of csvRows(await archive.stream("stops.txt"))) {
    if (!wantedStopIds.has(row.stop_id)) continue;
    const record: StopRecord = {
      stopId: row.stop_id,
      name: row.stop_name,
      lat: number(row.stop_lat),
      lon: number(row.stop_lon),
      locationType: number(row.location_type, 0),
      parentStation: row.parent_station || "",
      wheelchairBoarding: number(row.wheelchair_boarding, 0),
      rowHash: "",
    };
    record.rowHash = fnv1a(JSON.stringify(record));
    stops.push(record);
  }

  return {
    routes,
    patterns,
    shapes,
    stops,
    patternStops,
    stats: {
      routeCount: routes.length,
      patternCount: patterns.length,
      shapeCount: shapes.length,
      stopCount: stops.length,
      patternStopCount: patternStops.length,
    },
  };
}
