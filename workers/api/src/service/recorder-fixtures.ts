/** Recorder-level fixtures (corpus companions, workers side): the tiny
 * network, snapshots, and prediction scripts the Track A epic tests run
 * against. Everything here is deterministic — no live feed, no wall clock.
 *
 * Layout (all at latitude 43.653; 0.0001° of longitude ≈ 8.06 m there):
 *   - Route 506 runs east (direction 0) and west (direction 1) along the
 *     same street; stops A/B/C exist per direction as nearside platform
 *     pairs ~24 m apart — the adversarial direction case (§3.8).
 *   - Subway route 2 stations S1..S4 at a different latitude, shared station
 *     ids across the two directional patterns, so direction must come from
 *     sequence order (§3.8), never from stop identity. */

import type { D1Database } from '../../../shared/cloudflare/bindings';
import type {
  LiveVehicle,
  SubwayPrediction,
  VehicleSnapshot,
} from '../../../../shared/live/vehicles';

const LAT = 43.653;
const SUBWAY_LAT = 43.65;
const LON_A = -79.3988;
const LON_B = -79.3976;
const LON_C = -79.3964;
/** Side-by-side tracks: the westbound track runs ~28 m north of the
 * eastbound one (0.00025° of latitude), and the westbound platforms sit
 * ~16 m further west (0.0002° longitude) — the nearside/farside platform
 * geometry of a real intersection. The two directions' stops of one
 * intersection stay within the 40 m touch radius of each other: the
 * adversarial direction case (§3.8). */
const NEARSIDE_OFFSET_LAT = 0.00025;
const NEARSIDE_OFFSET_LON = 0.0002;

export const EAST_STOPS = {
  A: 'st_506_A_E',
  B: 'st_506_B_E',
  C: 'st_506_C_E',
} as const;
export const WEST_STOPS = {
  A: 'st_506_A_W',
  B: 'st_506_B_W',
  C: 'st_506_C_W',
} as const;
export const SUBWAY_STATIONS = ['st_2_S1', 'st_2_S2', 'st_2_S3', 'st_2_S4'] as const;

const eastPattern = {
  patternId: '506_E',
  routeId: '506',
  directionId: 0,
  shapeId: 'shape_506',
  stops: [
    { stopId: EAST_STOPS.A, lat: LAT, lon: LON_A },
    { stopId: EAST_STOPS.B, lat: LAT, lon: LON_B },
    { stopId: EAST_STOPS.C, lat: LAT, lon: LON_C },
  ],
};
const westPattern = {
  patternId: '506_W',
  routeId: '506',
  directionId: 1,
  shapeId: 'shape_506_rev',
  stops: [
    {
      stopId: WEST_STOPS.C,
      lat: LAT + NEARSIDE_OFFSET_LAT,
      lon: LON_C - NEARSIDE_OFFSET_LON,
    },
    {
      stopId: WEST_STOPS.B,
      lat: LAT + NEARSIDE_OFFSET_LAT,
      lon: LON_B - NEARSIDE_OFFSET_LON,
    },
    {
      stopId: WEST_STOPS.A,
      lat: LAT + NEARSIDE_OFFSET_LAT,
      lon: LON_A - NEARSIDE_OFFSET_LON,
    },
  ],
};
const subwayEastPattern = {
  patternId: '2_E',
  routeId: '2',
  directionId: 0,
  shapeId: 'shape_2',
  stops: SUBWAY_STATIONS.map((stopId, index) => ({
    stopId,
    lat: SUBWAY_LAT,
    lon: LON_A + index * 0.0012,
  })),
};
const subwayWestPattern = {
  patternId: '2_W',
  routeId: '2',
  directionId: 1,
  shapeId: 'shape_2_rev',
  stops: [...SUBWAY_STATIONS].reverse().map((stopId) => ({
    stopId,
    lat: SUBWAY_LAT,
    lon: LON_A + SUBWAY_STATIONS.indexOf(stopId) * 0.0012,
  })),
};

const PATTERNS = [eastPattern, westPattern, subwayEastPattern, subwayWestPattern];

/** Install a full fixture network version into a D1-shaped database. */
export async function installFixtureNetwork(
  db: D1Database,
  versionId: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO network_versions (
         id, source_key, source_url, r2_etag, r2_key, fetched_at, status, active
       ) VALUES (?, 'ttc-surface-gtfs', 'https://fixture.invalid', ?, ?, ?, 'imported', 1)`,
    )
    .bind(
      versionId,
      `etag-v${versionId}`,
      `fixture/v${versionId}.zip`,
      new Date(0).toISOString(),
    )
    .run();
  for (const pattern of PATTERNS) {
    await db
      .prepare(
        `INSERT INTO gtfs_patterns (
           version_id, pattern_id, route_id, direction_id, shape_id, headsign,
           representative_trip_id, trip_count, row_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        versionId,
        pattern.patternId,
        pattern.routeId,
        pattern.directionId,
        pattern.shapeId,
        'FIXTURE',
        pattern.patternId,
        `hash-${pattern.patternId}-v${versionId}`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO gtfs_shapes (version_id, shape_id, points_json, point_count, row_hash)
                VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        versionId,
        pattern.shapeId,
        JSON.stringify(shapePointsFor(pattern)),
        3,
        `hash-${pattern.shapeId}-v${versionId}`,
      )
      .run();
  }
  const stops = new Map<string, { lat: number; lon: number }>();
  for (const pattern of PATTERNS) {
    for (const stop of pattern.stops) {
      const existing = stops.get(stop.stopId);
      if (existing) continue;
      stops.set(stop.stopId, { lat: stop.lat, lon: stop.lon });
    }
  }
  for (const [stopId, coordinates] of stops) {
    await db
      .prepare(
        `INSERT INTO gtfs_stops (version_id, stop_id, name, lat, lon, location_type, parent_station, wheelchair_boarding, row_hash)
                VALUES (?, ?, ?, ?, ?, 0, '', 0, ?)`,
      )
      .bind(
        versionId,
        stopId,
        stopId,
        coordinates.lat,
        coordinates.lon,
        `hash-${stopId}-v${versionId}`,
      )
      .run();
  }
  for (const pattern of PATTERNS) {
    for (const [index, stop] of pattern.stops.entries()) {
      await db
        .prepare(
          `INSERT INTO gtfs_pattern_stops (version_id, pattern_id, stop_id, stop_sequence, row_hash)
                  VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          versionId,
          pattern.patternId,
          stop.stopId,
          index + 1,
          `hash-${pattern.patternId}-${index}-v${versionId}`,
        )
        .run();
    }
  }
}

function shapePointsFor(pattern: (typeof PATTERNS)[number]): Array<[number, number]> {
  if (pattern.routeId === '2') {
    const lons = [LON_A - 0.0012, LON_A, LON_A + 0.0012, LON_A + 0.0024];
    const ordered = pattern.directionId === 0 ? lons : [...lons].reverse();
    return ordered.map((lon) => [SUBWAY_LAT, lon]);
  }
  const lons = [LON_A - 0.0012, LON_A, LON_B, LON_C, LON_C + 0.0012];
  const ordered = pattern.directionId === 0 ? lons : [...lons].reverse();
  // Side-by-side tracks: westbound runs NEARSIDE_OFFSET_LAT north and its
  // platforms NEARSIDE_OFFSET_LON west.
  const lat = pattern.directionId === 1 ? LAT + NEARSIDE_OFFSET_LAT : LAT;
  const lonOffset = pattern.directionId === 1 ? -NEARSIDE_OFFSET_LON : 0;
  return ordered.map((lon) => [lat, lon + lonOffset]);
}

/** Flip which fixture version is active — the nightly GTFS flip, in miniature. */
export async function activateFixtureVersion(
  db: D1Database,
  versionId: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE network_versions SET active = 0 WHERE source_key = 'ttc-surface-gtfs'`,
    )
    .bind()
    .run();
  await db
    .prepare(`UPDATE network_versions SET active = 1 WHERE id = ?`)
    .bind(versionId)
    .run();
}

/** A fresh streetcar observation at a stop's platform. */
export function streetcarVehicle(
  id: string,
  at: { lat: number; lon: number },
  now: number,
  overrides: Partial<LiveVehicle> = {},
): LiveVehicle {
  return {
    id,
    label: id,
    latitude: at.lat,
    longitude: at.lon,
    routeId: '506',
    bearing: 90,
    observedAt: new Date(now).toISOString(),
    mode: 'streetcar',
    positionKind: 'gps',
    ...overrides,
  };
}

export const platformEast = { lat: LAT, lon: LON_A };
export const platformWest = {
  lat: LAT + NEARSIDE_OFFSET_LAT,
  lon: LON_A - NEARSIDE_OFFSET_LON,
};
export const terminalEast = { lat: LAT, lon: LON_C };

/** A snapshot with surface vehicles and (optionally) subway predictions. */
export function railSnapshot(
  now: number,
  vehicles: LiveVehicle[],
  options: {
    surface?: 'available' | 'unavailable';
    subway?: 'available' | 'unavailable';
    predictions?: SubwayPrediction[];
  } = {},
): VehicleSnapshot {
  const surface = options.surface ?? 'available';
  const subway = options.subway ?? 'available';
  return {
    schemaVersion: 1,
    fetchedAt: new Date(now).toISOString(),
    feedTimestamp: new Date(now).toISOString(),
    source: 'https://fixture.invalid',
    attribution: 'fixture',
    vehicles,
    invalidPositions: 0,
    surfaceStatus: surface,
    subwayStatus: subway,
    subwaySource: 'https://fixture.invalid/subway',
    subwayPredictions: options.predictions ?? [],
  };
}

/** A subway train prediction with ordered upcoming stations. */
export function subwayPrediction(
  trainId: string,
  now: number,
  upcoming: Array<{ stopId: string; sequence: number; arrivalAt: number }>,
  routeId = '2',
): SubwayPrediction {
  return {
    id: trainId,
    label: trainId,
    routeId,
    tripId: `${trainId}-trip`,
    observedAt: new Date(now).toISOString(),
    stops: upcoming.map((stop) => ({
      stopId: stop.stopId,
      sequence: stop.sequence,
      arrivalAt: new Date(stop.arrivalAt).toISOString(),
    })),
  };
}
