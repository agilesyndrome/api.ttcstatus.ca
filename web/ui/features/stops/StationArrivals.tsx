import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { arrivalCountdown, stationArrivals } from './arrivals';

interface Props {
  data: ViewerData;
  feature: Feature;
  snapshot?: VehicleSnapshot;
  now: number;
  enabled?: boolean;
  failed?: boolean;
}

export function StationArrivals({
  data,
  feature,
  snapshot,
  now,
  enabled,
  failed,
}: Props) {
  useLanguage();
  const arrivals = snapshot ? stationArrivals(data, feature, snapshot, now) : [];
  const unavailable = snapshot?.subwayStatus === 'unavailable' || (!snapshot && failed);
  return (
    <section
      className="station-arrivals"
      aria-label={t('stationArrivals.stationArrivals')}
    >
      <h2>{t('stationArrivals.upcomingTrains')}</h2>
      <p className="microcopy">
        {t('stationArrivals.subwayLrtPredictionsForThisStopTimesMayChangeCheck')}
      </p>
      {!enabled ? (
        <p>{t('stationArrivals.enableLiveVehiclesToSeeArrivalPredictions')}</p>
      ) : unavailable ? (
        <p role="status">
          {t('stationArrivals.subwayArrivalPredictionsAreTemporarilyUnavailable')}
        </p>
      ) : !snapshot ? (
        <p role="status">{t('stationArrivals.waitingForArrivalPredictions')}</p>
      ) : (
        <>
          {failed && (
            <p role="status">
              {t('stationArrivals.refreshUnavailableShowingRecentPredictions')}
            </p>
          )}
          {arrivals.length ? (
            <ol className="compact-list arrival-list">
              {arrivals.map(({ train, arrivalAt, onward }) => (
                <li key={train.id}>
                  <div>
                    <strong>
                      {t('stationArrivals.line')}{' '}
                      {data.routes.find((route) => route.id === train.routeId)?.number ??
                        train.routeId}
                      {' · '}
                      {t('viewer.train')} {train.label}
                    </strong>
                    <small>
                      {onward
                        ? t('stationArrivals.thenValue', { value1: onward })
                        : t('stationArrivals.directionNotSupplied')}
                    </small>
                  </div>
                  <div className="arrival-time">
                    <strong>{arrivalCountdown(arrivalAt, now)}</strong>
                    <time dateTime={arrivalAt}>
                      {new Date(arrivalAt).toLocaleTimeString(getLocale(), {
                        timeZone: 'America/Toronto',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p role="status">
              {t('stationArrivals.noFreshUpcomingPredictionsForThisStopThisDoesNot')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
