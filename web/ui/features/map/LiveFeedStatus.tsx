import { t, getLocale, plural } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { vehicleIsStale } from '../../../../shared/live/vehicles';
export interface FeedState {
  snapshot?: VehicleSnapshot;
  failed: boolean;
  active: boolean;
  updateSeconds: number;
  retrySeconds: number;
  now: number;
}
export function LiveFeedStatus({
  snapshot,
  failed,
  active,
  updateSeconds,
  retrySeconds,
  now,
}: FeedState) {
  useLanguage();
  const stale =
    snapshot?.vehicles.filter((vehicle) => vehicleIsStale(vehicle, snapshot, now))
      .length ?? 0;
  return (
    <section className="live-status" aria-label={t('liveFeedStatus.liveFeedStatus')}>
      <h2>
        <span className="live-dot" aria-hidden="true" />{' '}
        {t('liveFeedStatus.liveTrainsStreetcars')}
      </h2>
      <p role="status">
        {snapshot
          ? plural('counts.vehicleReports', snapshot.vehicles.length, {
              stale: stale ? t('viewer.valueStale', { value1: stale }) : '',
            })
          : failed
            ? t('liveFeedStatus.livePositionsUnavailable')
            : active
              ? t('liveFeedStatus.loadingVehicleReports')
              : t('liveFeedStatus.liveUpdatesPaused')}{' '}
        {failed && snapshot && t('liveFeedStatus.refreshUnavailableKeepingLastPositions')}{' '}
        {failed && active && t('liveFeedStatus.retryInValueS', { value1: retrySeconds })}{' '}
        {!active && snapshot && t('liveFeedStatus.updatesPaused')}
      </p>
      {snapshot?.surfaceStatus === 'unavailable' && (
        <p>{t('liveFeedStatus.streetcarPositionsUnavailable')}</p>
      )}
      {snapshot?.subwayStatus && (
        <p>
          {snapshot.subwayStatus === 'unavailable'
            ? t('liveFeedStatus.subwayPredictionsUnavailable')
            : t(
                'liveFeedStatus.valueTrainPredictionsMarkersShowNextReportedStationNotGps',
                { value1: snapshot.subwayPredictions?.length ?? 0 },
              )}{' '}
          {t('liveFeedStatus.linesWithoutLiveReportsShowRoutesOnly')}
        </p>
      )}
      {snapshot && (
        <p>
          {t('liveFeedStatus.positions')}{' '}
          {new Date(snapshot.feedTimestamp ?? snapshot.fetchedAt).toLocaleTimeString(
            getLocale(),
            { timeZone: 'America/Toronto' },
          )}{' '}
          {t('liveFeedStatus.updatesEvery')} {updateSeconds}
          {t('liveFeedStatus.s')}
        </p>
      )}
    </section>
  );
}
