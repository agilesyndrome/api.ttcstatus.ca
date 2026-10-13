import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import type { JournalEntry } from '../../../../shared/accounts/journal';
import { formatDistance, nearbyCars } from '../../commute';
import { StationArrivals } from './StationArrivals';
import { VehicleJourney } from './VehicleJourney';
interface Props {
  data: ViewerData;
  feature?: Feature;
  car?: PlottedVehicle;
  cars?: PlottedVehicle[];
  saved?: boolean;
  saveLimit?: boolean;
  feedLoaded?: boolean;
  liveEnabled?: boolean;
  feedFailed?: boolean;
  snapshot?: VehicleSnapshot;
  now?: number;
  journalEntry?: JournalEntry;
  journalFull?: boolean;
  journalReady?: boolean;
  onJournal?(): void;
  following?: boolean;
  onFollow?(): void;
  onToggleSave?(): void;
  onSelectVehicle?(car: PlottedVehicle): void;
  serviceMode?: boolean;
  onClose(): void;
}
export function StopDetails({
  data,
  feature,
  car,
  cars = [],
  saved,
  saveLimit,
  feedLoaded,
  liveEnabled,
  feedFailed,
  snapshot,
  now = Date.now(),
  following,
  onFollow,
  journalEntry,
  journalFull,
  journalReady,
  onJournal,
  onToggleSave,
  onSelectVehicle,
  serviceMode = false,
  onClose,
}: Props) {
  useLanguage();
  if (car)
    return (
      <section id="details" aria-live="polite">
        <p className="eyebrow">
          {car.vehicle.mode === 'subway'
            ? t('viewer.subwayLrtTrain')
            : t('viewer.flexityStreetcar')}
        </p>
        <div className="details-heading">
          <h1>
            {car.vehicle.mode === 'subway' ? t('viewer.train') : t('viewer.car')}{' '}
            {car.vehicle.label}
          </h1>
          <button
            className="close-details"
            aria-label={t('viewer.closeStreetcarDetails')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="vehicle-route-line">
          {car.vehicle.routeId &&
            `${data.routes.find((route) => route.id === car.vehicle.routeId)?.number ?? car.vehicle.routeId} · `}
          {data.routes.find((route) => route.id === car.vehicle.routeId)?.name ??
            t('header.routeNotSupplied')}
          {car.stale && t('viewer.stalePosition')}
        </p>
        {onFollow && (
          <div className="vehicle-follow">
            <button
              className="action-button follow-car"
              aria-pressed={Boolean(following)}
              onClick={onFollow}
            >
              {following
                ? t('vehicleJourney.pauseFollowing')
                : t('vehicleJourney.followCar')}
            </button>
            <span>
              {following ? t('vehicleJourney.following') : t('vehicleJourney.paused')}
            </span>
            {onJournal && car.vehicle.mode !== 'subway' && (
              <button
                className="vehicle-journal-action"
                disabled={!journalEntry && (!journalReady || journalFull)}
                onClick={onJournal}
              >
                {journalEntry
                  ? t('stopDetails.journalEntryStatus', {
                      status:
                        journalEntry.status === 'ridden'
                          ? t('journal.ridden')
                          : t('journal.seen'),
                      date: new Date(journalEntry.recordedAt).toLocaleDateString(
                        getLocale(),
                        {
                          timeZone: 'America/Toronto',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        },
                      ),
                    })
                  : journalFull
                    ? t('stopDetails.journalFull500Cars')
                    : t('stopDetails.addToJournal')}
              </button>
            )}
          </div>
        )}
        {car.vehicle.mode !== 'subway' && (
          <VehicleJourney key={car.vehicle.id} data={data} car={car} />
        )}
        <details className="vehicle-telemetry">
          <summary>{t('vehicleJourney.positionDetails')}</summary>
          <p>
            {car.vehicle.positionKind === 'next-station'
              ? t('stopDetails.nextStationValueMarkerShowsThePredictedStationNotA', {
                  value1: car.vehicle.nextStopName ?? t('viewer.notSupplied'),
                })
              : car.match
                ? t('stopDetails.positionMatchedToMappedTrack')
                : t('stopDetails.offMappedTrackShowingGpsLocation')}
          </p>
          <dl className="stop-facts">
            <dt>{t('viewer.positionReported')}</dt>
            <dd>
              {car.vehicle.observedAt
                ? new Date(car.vehicle.observedAt).toLocaleString(getLocale(), {
                    timeZone: 'America/Toronto',
                  })
                : t('viewer.timeNotSupplied')}
            </dd>
            {car.vehicle.speedMetresPerSecond !== undefined && (
              <>
                <dt>{t('viewer.reportedSpeed')}</dt>
                <dd>
                  {Math.round(car.vehicle.speedMetresPerSecond * 3.6)} {t('snake.kmH')}
                </dd>
              </>
            )}
          </dl>
        </details>
      </section>
    );
  if (!feature) return null;
  const nearby = nearbyCars(data, feature, cars);
  const rapidRoutes = new Set(
    data.routes
      .filter((route) => /^(1|2|4|5|6)$/.test(route.number))
      .map((route) => route.id),
  );
  return (
    <section
      id="details"
      className={serviceMode ? 'details--service' : undefined}
      aria-live="polite"
    >
      {!serviceMode && (
        <p className="eyebrow">
          {feature.kind === 'terminal'
            ? t('viewer.stationTerminal')
            : t('stopDetails.transitStop')}
        </p>
      )}
      {!serviceMode && (
        <div className="details-heading">
          <h1>{feature.name}</h1>
          <button
            className="close-details"
            aria-label={t('viewer.closeStopDetails')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      )}
      {!serviceMode && (
        <p>
          {feature.routeIds.length
            ? feature.routeIds
                .map((id) => {
                  const route = data.routes.find((route) => route.id === id);
                  return route ? `${route.number} ${route.name}` : id;
                })
                .join(' · ')
            : t('stopDetails.physicalTerminalWithoutScheduledStreetcarBoardingRecords')}
        </p>
      )}
      {onToggleSave && (
        <>
          <button
            className="action-button save-stop"
            aria-pressed={Boolean(saved)}
            disabled={!saved && saveLimit}
            onClick={onToggleSave}
          >
            {saved ? t('stopDetails.savedStop') : t('stopDetails.saveStop')}
          </button>
          {!saved && saveLimit && (
            <p className="microcopy">
              {t('workspace.your100SavedStopsAreFullRemoveAStopTo')}
            </p>
          )}
        </>
      )}
      <dl className="stop-facts">
        <dt>{t('stopDetails.boardingPoints')}</dt>
        <dd>{feature.boardingPoints}</dd>
        <dt>{t('viewer.accessibleBoarding')}</dt>
        <dd>
          {feature.accessible
            ? t('viewer.listedAtOneOrMoreBoardingPoints')
            : t('viewer.notConfirmedInThisSnapshot')}
        </dd>
      </dl>
      {feature.boardingPoints > 0 &&
        feature.routeIds.some((id) => rapidRoutes.has(id)) && (
          <StationArrivals
            data={data}
            feature={feature}
            snapshot={snapshot}
            now={now}
            enabled={liveEnabled}
            failed={feedFailed}
          />
        )}
      {onSelectVehicle &&
        feature.boardingPoints > 0 &&
        feature.routeIds.some((id) => !rapidRoutes.has(id)) && (
          <div className="stop-cars">
            <h2>{t('stopDetails.streetcarsNearby')}</h2>
            <p className="microcopy">
              {t('stopDetails.freshReportsOnThisStopSRoutesWithin2Km')}
            </p>
            {!liveEnabled ? (
              <p>{t('stopDetails.enableLiveStreetcarsToSeeNearbyCars')}</p>
            ) : !feedLoaded ? (
              <p>
                {feedFailed
                  ? t('liveFeedStatus.livePositionsUnavailable')
                  : t('stopDetails.waitingForVehiclePositions')}
              </p>
            ) : (
              <>
                {feedFailed && (
                  <p>{t('stopDetails.refreshUnavailableShowingTheLastSnapshot')}</p>
                )}
                {nearby.length ? (
                  <ul className="compact-list">
                    {nearby.map(({ car, metres }) => (
                      <li key={car.vehicle.id}>
                        <button
                          className="list-choice"
                          onClick={() => onSelectVehicle(car)}
                        >
                          <strong>
                            {t('viewer.car')} {car.vehicle.label}
                            <span className="distance">{formatDistance(metres)}</span>
                          </strong>
                          <small>
                            {
                              data.routes.find(
                                (route) => route.id === car.vehicle.routeId,
                              )?.number
                            }{' '}
                            {t('stopDetails.viewOnMap')}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('stopDetails.noFreshCarsReportedNearbyOnTheseRoutes')}</p>
                )}
              </>
            )}
          </div>
        )}
      {Object.values(feature.destinations).flat().length > 0 && (
        <details>
          <summary>{t('viewer.scheduledDestinations')}</summary>
          <ul>
            {[...new Set(Object.values(feature.destinations).flat())].map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
