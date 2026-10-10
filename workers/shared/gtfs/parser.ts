import { csvRows } from './csv';
import { fnv1a } from './hash';
import type {
  PatternRecord,
  PatternStopRecord,
  RouteRecord,
  ShapeRecord,
  StopRecord,
} from './models';
import type { R2ZipArchive } from './zip';

const RAPID_LINES = new Set(['1', '2', '4', '5', '6']);

function number(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function patternKey(
  routeId: string,
  directionId: number,
  shapeId: string,
  headsign: string,
): string {
  return `${routeId}|${directionId}|${shapeId}|${headsign}`;
}

/** Raw schedule materials for the promise lens (Epic 8, E8S1): every
 * streetcar trip's calendar membership and departure times, collected during
 * the same streaming passes the map import already pays for. The derived
 * per-stop / per-route headway bands live in sla-schedule.ts — pure, tested. */
export interface ScheduleMaterials {
  /** trip_id → the trip's service class, direction, route, and headsign. */
  trips: Map<
    string,
    { serviceId: string; directionId: number; routeId: string; headsign: string }
  >;
  /** stop_id → service_id → route_id → departure seconds (GTFS convention:
   * >24 h for overnight trips). Row order; sorted at derivation time. The
   * route dimension is what keeps a night route's published promise its own:
   * stop-level bands pool every route serving the stop (a rider at the stop
   * cares about all of them), route-level bands filter to the route's own
   * departures — otherwise the 306 would inherit the 506's daytime service
   * on their shared corridor. */
  departuresByStop: Map<string, Map<string, Map<string, number[]>>>;
  /** stop_id → the direction its serving trips run (directional stops agree;
   * first-seen wins on any data quirk). */
  stopDirections: Map<string, number>;
  /** stop_id → the headsign of its serving trips (first-seen) — the "towards
   * X" label the stop rows show. */
  stopHeadsigns: Map<string, string>;
  /** stop_id → routes serving it (corridor membership). */
  stopRoutes: Map<string, Set<string>>;
  /** calendar.txt rows: service_id → weekday bits [Mon..Sun] + window. */
  calendarServices: Map<
    string,
    { weekdays: number[]; startDate: string; endDate: string }
  >;
  /** calendar_dates.txt exceptions: date 'YYYYMMDD', service, added/removed. */
  calendarExceptions: Array<{ dateKey: string; serviceId: string; added: boolean }>;
}

export interface ParsedStreetcarGtfs {
  routes: RouteRecord[];
  patterns: PatternRecord[];
  shapes: ShapeRecord[];
  stops: StopRecord[];
  patternStops: PatternStopRecord[];
  /** Present whenever the feed carries trips + stop_times (the merged feed
   * always does); the promise lens derives from it, nothing else changes. */
  schedule: ScheduleMaterials;
  stats: {
    routeCount: number;
    patternCount: number;
    shapeCount: number;
    stopCount: number;
    patternStopCount: number;
  };
}

/** 'HH:MM:SS' (hours may exceed 24 for overnight trips) → seconds. */
function gtfsSeconds(value: string): number {
  if (typeof value !== 'string') return Number.NaN;
  const [hours, minutes, seconds] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds))
    return Number.NaN;
  return hours * 3600 + minutes * 60 + seconds;
}

export async function parseStreetcarGtfs(
  archive: R2ZipArchive,
): Promise<ParsedStreetcarGtfs> {
  const routes: RouteRecord[] = [];
  const streetcarRouteIds = new Set<string>();

  for await (const row of csvRows(await archive.stream('routes.txt'))) {
    const routeType = number(row.route_type, -1);
    if (row.route_short_name === '3') continue;
    if (routeType !== 0 && !(routeType === 1 && RAPID_LINES.has(row.route_short_name)))
      continue;
    const record: RouteRecord = {
      routeId: row.route_id,
      shortName: row.route_short_name,
      longName: row.route_long_name,
      routeType,
      color: row.route_color || 'D71920',
      textColor: row.route_text_color || 'FFFFFF',
      rowHash: '',
    };
    record.rowHash = fnv1a(JSON.stringify(record));
    routes.push(record);
    streetcarRouteIds.add(record.routeId);
  }

  if (routes.length === 0)
    throw new Error('GTFS import found no route_type=0 streetcar routes');

  type PatternAccumulator = {
    routeId: string;
    directionId: number;
    shapeId: string;
    headsign: string;
    representativeTripId: string;
    tripCount: number;
  };
  const accumulators = new Map<string, PatternAccumulator>();

  const schedule: ScheduleMaterials = {
    trips: new Map(),
    departuresByStop: new Map(),
    stopDirections: new Map(),
    stopHeadsigns: new Map(),
    stopRoutes: new Map(),
    calendarServices: new Map(),
    calendarExceptions: [],
  };

  for await (const row of csvRows(await archive.stream('trips.txt'))) {
    if (!streetcarRouteIds.has(row.route_id) || !row.shape_id) continue;
    const directionId = number(row.direction_id, 0);
    const headsign = row.trip_headsign || '';
    // Promise-lens materials: every streetcar trip, not just representatives.
    schedule.trips.set(row.trip_id, {
      serviceId: row.service_id,
      directionId,
      routeId: row.route_id,
      headsign,
    });
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
      rowHash: '',
    };
    record.rowHash = fnv1a(JSON.stringify(record));
    return record;
  });

  if (patterns.length === 0)
    throw new Error('GTFS import found no streetcar trip patterns');

  const wantedShapeIds = new Set(patterns.map((pattern) => pattern.shapeId));
  const shapePoints = new Map<
    string,
    Array<{ sequence: number; lat: number; lon: number }>
  >();

  for await (const row of csvRows(await archive.stream('shapes.txt'))) {
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
    const record: ShapeRecord = {
      shapeId,
      points,
      rowHash: fnv1a(JSON.stringify(points)),
    };
    shapes.push(record);
  }

  // Calendar membership + exceptions: the service sets that turn dates into
  // schedule classes ('weekday', 'holiday', school-day layers — exact sets,
  // never weekday folklore).
  for await (const row of csvRows(await archive.stream('calendar.txt'))) {
    schedule.calendarServices.set(row.service_id, {
      weekdays: [
        number(row.monday),
        number(row.tuesday),
        number(row.wednesday),
        number(row.thursday),
        number(row.friday),
        number(row.saturday),
        number(row.sunday),
      ],
      startDate: row.start_date,
      endDate: row.end_date,
    });
  }
  for await (const row of csvRows(await archive.stream('calendar_dates.txt'))) {
    schedule.calendarExceptions.push({
      dateKey: row.date,
      serviceId: row.service_id,
      added: number(row.exception_type) === 1,
    });
  }

  const tripToPattern = new Map(
    patterns.map((pattern) => [pattern.representativeTripId, pattern.patternId]),
  );
  const wantedStopIds = new Set<string>();
  const patternStops: PatternStopRecord[] = [];

  for await (const row of csvRows(await archive.stream('stop_times.txt'))) {
    // Promise-lens materials ride the pass the import already pays for: every
    // streetcar trip's departure at every stop it serves.
    const trip = schedule.trips.get(row.trip_id);
    if (trip) {
      const seconds = gtfsSeconds(row.departure_time || row.arrival_time);
      if (Number.isFinite(seconds)) {
        const byService = schedule.departuresByStop.get(row.stop_id) ?? new Map();
        const byRoute = byService.get(trip.serviceId) ?? new Map();
        const secondsList = byRoute.get(trip.routeId) ?? [];
        secondsList.push(seconds);
        byRoute.set(trip.routeId, secondsList);
        byService.set(trip.serviceId, byRoute);
        schedule.departuresByStop.set(row.stop_id, byService);
        if (!schedule.stopDirections.has(row.stop_id)) {
          schedule.stopDirections.set(row.stop_id, trip.directionId);
          schedule.stopHeadsigns.set(row.stop_id, trip.headsign);
        }
        const routes = schedule.stopRoutes.get(row.stop_id) ?? new Set();
        routes.add(trip.routeId);
        schedule.stopRoutes.set(row.stop_id, routes);
        wantedStopIds.add(row.stop_id);
      }
    }
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
  for await (const row of csvRows(await archive.stream('stops.txt'))) {
    if (!wantedStopIds.has(row.stop_id)) continue;
    const record: StopRecord = {
      stopId: row.stop_id,
      name: row.stop_name,
      lat: number(row.stop_lat),
      lon: number(row.stop_lon),
      locationType: number(row.location_type, 0),
      parentStation: row.parent_station || '',
      wheelchairBoarding: number(row.wheelchair_boarding, 0),
      rowHash: '',
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
    schedule,
    stats: {
      routeCount: routes.length,
      patternCount: patterns.length,
      shapeCount: shapes.length,
      stopCount: stops.length,
      patternStopCount: patternStops.length,
    },
  };
}
