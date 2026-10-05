import { t } from '../../i18n';
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
  if (!enabled) return [t('saved-stop-status.liveUpdatesOff')];
  if (!snapshot) return [t('saved-stop-status.waitingForLiveReports')];
  const rapidIds = new Set(
    data.routes
      .filter((route) => /^(1|2|4|5|6)$/.test(route.number))
      .map((route) => route.id),
  );
  const summary: string[] = [];
  if (feature.routeIds.some((id) => rapidIds.has(id))) {
    if (snapshot.subwayStatus === 'unavailable')
      summary.push(t('saved-stop-status.trainPredictionsUnavailable'));
    else {
      const arrivals = stationArrivals(data, feature, snapshot, now).slice(0, 2);
      summary.push(
        arrivals.length
          ? arrivals
              .map(({ train, arrivalAt }) =>
                t('saved-stop-status.lineValueValue', {
                  value1:
                    data.routes.find((route) => route.id === train.routeId)?.number ??
                    train.routeId,
                  value2: arrivalCountdown(arrivalAt, now),
                }),
              )
              .join(' / ')
          : t('saved-stop-status.noFreshTrainPredictions'),
      );
    }
  }
  if (feature.routeIds.some((id) => !rapidIds.has(id))) {
    if (snapshot.surfaceStatus === 'unavailable')
      summary.push(t('saved-stop-status.streetcarPositionsUnavailable'));
    else {
      const nearest = nearbyCars(data, feature, cars)[0];
      summary.push(
        nearest
          ? t('saved-stop-status.carValueValueAway', {
              value1: nearest.car.vehicle.label,
              value2: formatDistance(nearest.metres),
            })
          : t('saved-stop-status.noFreshStreetcarsWithin2Km'),
      );
    }
  }
  return summary;
}
