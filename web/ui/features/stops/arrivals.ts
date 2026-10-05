import { t } from '../../i18n';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import {
  VEHICLE_STALE_AFTER_MS,
  type VehicleSnapshot,
} from '../../../../shared/live/vehicles';

/** Match actual boarding IDs, never proximity to a train's schematic marker. */
export function stationArrivals(
  data: ViewerData,
  feature: Feature,
  snapshot: VehicleSnapshot,
  now: number,
) {
  if (snapshot.subwayStatus === 'unavailable') return [];
  const stopIds = new Set(feature.stopIds ?? []);
  return (snapshot.subwayPredictions ?? [])
    .flatMap((train) => {
      // The surface feed timestamp cannot establish freshness for a subway report.
      const observed = Date.parse(train.observedAt ?? '');
      if (
        !feature.routeIds.includes(train.routeId) ||
        !Number.isFinite(observed) ||
        now - observed > VEHICLE_STALE_AFTER_MS ||
        observed > now + 60_000
      )
        return [];
      const stop = train.stops
        .filter((stop) => stopIds.has(stop.stopId) && Date.parse(stop.arrivalAt) >= now)
        .sort((a, b) => Date.parse(a.arrivalAt) - Date.parse(b.arrivalAt))[0];
      if (!stop) return [];
      const next = train.stops
        .filter((candidate) => candidate.sequence > stop.sequence)
        .sort((a, b) => a.sequence - b.sequence)[0];
      const onward =
        next &&
        data.features.find(
          (candidate) =>
            candidate.id !== feature.id &&
            candidate.routeIds.includes(train.routeId) &&
            candidate.stopIds?.includes(next.stopId),
        );
      return [{ train, arrivalAt: stop.arrivalAt, onward: onward?.name }];
    })
    .sort(
      (a, b) =>
        Date.parse(a.arrivalAt) - Date.parse(b.arrivalAt) ||
        a.train.id.localeCompare(b.train.id),
    )
    .slice(0, 6);
}

export function arrivalCountdown(arrivalAt: string, now: number) {
  const remaining = Date.parse(arrivalAt) - now;
  return remaining < 60_000 ? t('arrivals.due') : `${Math.ceil(remaining / 60_000)} min`;
}
