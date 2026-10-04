import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { formatDistance, nearbyCars } from '../../commute';
import { arrivalCountdown, stationArrivals } from './arrivals';

export function savedStopStatus(
  data: ViewerData,
  feature: Feature,
  snapshot: VehicleSnapshot | undefined,
  cars: PlottedVehicle[],
  now: number,
  enabled: boolean,
): string[] {
  if (!feature.boardingPoints) return [];
  if (!enabled) return ['Live updates off'];
  if (!snapshot) return ['Waiting for live reports'];
  const rapidIds = new Set(
    data.routes
      .filter((route) => /^(1|2|4|5|6)$/.test(route.number))
      .map((route) => route.id),
  );
  const summary: string[] = [];
  if (feature.routeIds.some((id) => rapidIds.has(id))) {
    if (snapshot.subwayStatus === 'unavailable')
      summary.push('Train predictions unavailable');
    else {
      const arrivals = stationArrivals(data, feature, snapshot, now).slice(0, 2);
      summary.push(
        arrivals.length
          ? arrivals
              .map(
                ({ train, arrivalAt }) =>
                  `Line ${data.routes.find((route) => route.id === train.routeId)?.number ?? train.routeId} · ${arrivalCountdown(arrivalAt, now)}`,
              )
              .join(' / ')
          : 'No fresh train predictions',
      );
    }
  }
  if (feature.routeIds.some((id) => !rapidIds.has(id))) {
    if (snapshot.surfaceStatus === 'unavailable')
      summary.push('Streetcar positions unavailable');
    else {
      const nearest = nearbyCars(data, feature, cars)[0];
      summary.push(
        nearest
          ? `Car ${nearest.car.vehicle.label} · ${formatDistance(nearest.metres)} away`
          : 'No fresh streetcars within 2 km',
      );
    }
  }
  return summary;
}
