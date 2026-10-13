/** Device-only proximity (see LocalSpatialIndex's broadcast-only invariant):
 * nearest stop is computed on the device against the broadcast snapshot;
 * nothing here is ever sent anywhere. */
import { mapToGps } from '../map/projection';
import type { PlottedVehicle } from '../map/live-status';
import type { Feature, Route, ViewerData } from '../map/model';
import type { Location } from './types';
import { LocalSpatialIndex } from './spatial-index';

interface IndexedStop extends Location {
  feature: Feature;
  accessible: boolean | null;
}
const stopIndexes = new WeakMap<ViewerData, LocalSpatialIndex<IndexedStop>>();

function stopIndex(data: ViewerData): LocalSpatialIndex<IndexedStop> {
  let index = stopIndexes.get(data);
  if (!index) {
    const points = data.features
      .filter((feature) => feature.boardingPoints > 0)
      .flatMap((feature) => {
        // Legacy cached maps remain usable; new artifacts always retain original points.
        const positions = feature.geographicPoints ?? [
          {
            ...mapToGps(feature.point, data.geographicTransform),
            accessible: feature.accessible,
          },
        ];
        return positions.map((point) => ({ ...point, feature }));
      });
    index = new LocalSpatialIndex(points);
    stopIndexes.set(data, index);
  }
  return index;
}

/** Measure geography, never distances on the compressed schematic. */
export function distanceMetres(a: Location, b: Location): number {
  const radians = Math.PI / 180;
  const latitude = (b.latitude - a.latitude) * radians;
  const longitude = (b.longitude - a.longitude) * radians;
  const h =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function nearbyStops(
  data: ViewerData,
  location: Location,
  accessibleOnly = false,
) {
  const matches = new Map<string, { feature: Feature; metres: number }>();
  for (const point of stopIndex(data).within(location, 2500)) {
    if (accessibleOnly && point.accessible !== true) continue;
    const metres = distanceMetres(location, point);
    if (metres > 2500) continue;
    const previous = matches.get(point.feature.id);
    if (!previous || metres < previous.metres)
      matches.set(point.feature.id, { feature: point.feature, metres });
  }
  return [...matches.values()]
    .sort((a, b) => a.metres - b.metres || a.feature.id.localeCompare(b.feature.id))
    .slice(0, 5);
}

/** Pick map focus points by real distance, with a different daytime route and
 * physical stop for the second point. The general nearby list is capped at
 * five boarding points, which can all be platforms on the first route. */
export function nearestDistinctRouteStops(
  data: ViewerData,
  location: Location,
): Feature[] {
  if (
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    Math.abs(location.latitude) > 90 ||
    Math.abs(location.longitude) > 180
  )
    return [];
  const dayRoutes = new Set(
    data.routes
      .filter((route) => route.scheduled && !route.overnight)
      .map((route) => route.id),
  );
  const candidates = data.features
    .filter((feature) => feature.boardingPoints > 0)
    .map((feature) => {
      const routeIds = feature.routeIds.filter((id) => dayRoutes.has(id));
      const positions = feature.geographicPoints?.length
        ? feature.geographicPoints
        : [mapToGps(feature.point, data.geographicTransform)];
      const position = positions.reduce((nearest, point) =>
        distanceMetres(location, point) < distanceMetres(location, nearest)
          ? point
          : nearest,
      );
      return { feature, routeIds, position, metres: distanceMetres(location, position) };
    })
    .filter((candidate) => candidate.routeIds.length && Number.isFinite(candidate.metres))
    .sort((a, b) => a.metres - b.metres || a.feature.id.localeCompare(b.feature.id));
  const first = candidates[0];
  // Outside the mapped service area, preserve the full-map fallback.
  if (!first || first.metres > 2500) return [];
  const firstRoutes = new Set(first.routeIds);
  const second = candidates.find(
    (candidate) =>
      candidate.feature.id !== first.feature.id &&
      candidate.routeIds.every((id) => !firstRoutes.has(id)) &&
      distanceMetres(first.position, candidate.position) >= 75,
  );
  return second ? [first.feature, second.feature] : [first.feature];
}
/** Nearby is proximity only: route, direction and trip stop sequence cannot
 * establish arrival predictions from the vehicle-position feed. */
export function nearbyCars(data: ViewerData, feature: Feature, cars: PlottedVehicle[]) {
  const locations = feature.geographicPoints?.length
    ? feature.geographicPoints
    : [mapToGps(feature.point, data.geographicTransform)];
  const rapidRoutes = new Set(
    data.routes
      .filter((route) => /^(1|2|4|5|6)$/.test(route.number))
      .map((route) => route.id),
  );
  return cars
    .filter(
      (car) =>
        !car.stale &&
        car.vehicle.mode !== 'subway' &&
        car.vehicle.positionKind !== 'next-station' &&
        !rapidRoutes.has(car.vehicle.routeId ?? '') &&
        car.vehicle.routeId &&
        feature.routeIds.includes(car.vehicle.routeId),
    )
    .map((car) => ({
      car,
      metres: Math.min(
        ...locations.map((location) => distanceMetres(location, car.vehicle)),
      ),
    }))
    .filter((car) => car.metres <= 2000)
    .sort(
      (a, b) => a.metres - b.metres || a.car.vehicle.id.localeCompare(b.car.vehicle.id),
    )
    .slice(0, 3);
}
export function routeActivity(route: Route, cars: PlottedVehicle[]) {
  const assigned = cars.filter((car) => car.vehicle.routeId === route.id);
  const fresh = assigned.filter((car) => !car.stale);
  const speeds = fresh
    .flatMap((car) =>
      car.vehicle.speedMetresPerSecond === undefined
        ? []
        : [car.vehicle.speedMetresPerSecond * 3.6],
    )
    .sort((a, b) => a - b);
  const middle = Math.floor(speeds.length / 2);
  const medianSpeed = speeds.length
    ? speeds.length % 2
      ? speeds[middle]
      : (speeds[middle - 1] + speeds[middle]) / 2
    : undefined;
  return {
    reported: assigned.length,
    fresh: fresh.length,
    stale: assigned.length - fresh.length,
    medianSpeed,
  };
}
