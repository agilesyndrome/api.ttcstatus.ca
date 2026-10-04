import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { Route } from '../../../../shared/map/model';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { distanceMetres, type Location } from '../../commute';

export interface FleetFilters {
  query: string;
  route: string; // Empty means all; values use route:<id> or unassigned.
  status: 'all' | 'fresh' | 'stale' | 'off-track';
  sort: 'number' | 'speed' | 'distance';
}
export const DEFAULT_FLEET_FILTERS: FleetFilters = {
  query: '',
  route: '',
  status: 'all',
  sort: 'number',
};
export function filterFleet(
  cars: PlottedVehicle[],
  routes: Route[],
  filters: FleetFilters,
  location?: Location,
) {
  const needle = filters.query
    .trim()
    .toLowerCase()
    .replace(/^(?:car|streetcar|train)\s*#?\s*|^#\s*/, '');
  const routesById = new Map(routes.map((route) => [route.id, route]));
  const results = cars
    .filter((car) => {
      const route = routesById.get(car.vehicle.routeId ?? '');
      const text =
        `${car.vehicle.id} ${car.vehicle.label} ${route?.number ?? ''} ${route?.name ?? ''}`.toLowerCase();
      return (
        (!needle || text.includes(needle)) &&
        (!filters.route ||
          (filters.route === 'unassigned'
            ? !car.vehicle.routeId
            : car.vehicle.routeId === filters.route.slice(6))) &&
        (filters.status === 'all' ||
          (filters.status === 'fresh'
            ? !car.stale
            : filters.status === 'stale'
              ? car.stale
              : !car.match))
      );
    })
    .map((car) => ({
      car,
      metres: location ? distanceMetres(location, car.vehicle) : undefined,
    }));
  return results.sort((a, b) => {
    if (filters.sort === 'distance' && location)
      return (
        a.metres! - b.metres! ||
        a.car.vehicle.id.localeCompare(b.car.vehicle.id, undefined, { numeric: true })
      );
    if (filters.sort === 'speed') {
      // Unknown or stale speeds never outrank a fresh speed, including zero.
      const speed = (car: PlottedVehicle) =>
        car.stale ? -1 : (car.vehicle.speedMetresPerSecond ?? -1);
      const difference = speed(b.car) - speed(a.car);
      if (difference) return difference;
    }
    return a.car.vehicle.id.localeCompare(b.car.vehicle.id, undefined, { numeric: true });
  });
}

/** Quote CSV fields and neutralize spreadsheet formulas, including leading
 * whitespace/control characters. The source labels are external feed data. */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function fleetCsv(
  cars: PlottedVehicle[],
  routes: Route[],
  snapshot: Pick<VehicleSnapshot, 'fetchedAt' | 'feedTimestamp'> &
    Partial<Pick<VehicleSnapshot, 'source' | 'attribution' | 'subwaySource'>>,
): string {
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const rows: unknown[][] = [
    [
      'vehicle_id',
      'label',
      'route_id',
      'route_number',
      'route_name',
      'latitude',
      'longitude',
      'observed_at',
      'freshness',
      'track_match',
      'reported_speed_kmh',
      'fetched_at',
      'feed_timestamp',
      'source',
      'attribution',
      'position_kind',
      'next_station',
      'predicted_arrival',
    ],
  ];
  for (const car of cars) {
    const vehicle = car.vehicle,
      route = routeById.get(vehicle.routeId ?? '');
    rows.push([
      vehicle.id,
      vehicle.label,
      vehicle.routeId,
      route?.number,
      route?.name,
      vehicle.latitude,
      vehicle.longitude,
      vehicle.observedAt,
      car.stale ? 'stale' : 'fresh',
      car.match ? 'matched' : 'off mapped track',
      vehicle.speedMetresPerSecond === undefined
        ? undefined
        : Math.round(vehicle.speedMetresPerSecond * 36) / 10,
      snapshot.fetchedAt,
      snapshot.feedTimestamp,
      vehicle.mode === 'subway' ? snapshot.subwaySource : snapshot.source,
      snapshot.attribution,
      vehicle.positionKind ?? 'gps',
      vehicle.nextStopName,
      vehicle.arrivalAt,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
