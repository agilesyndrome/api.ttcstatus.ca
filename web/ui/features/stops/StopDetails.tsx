import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import { formatDistance, nearbyCars } from '../../commute';
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
  journalSaved?: boolean;
  journalFull?: boolean;
  onJournal?(): void;
  onOpenJournal?(): void;
  following?: boolean;
  onFollow?(): void;
  onToggleSave?(): void;
  onSelectVehicle?(car: PlottedVehicle): void;
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
  following,
  onFollow,
  journalSaved,
  journalFull,
  onJournal,
  onOpenJournal,
  onToggleSave,
  onSelectVehicle,
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
        <p>
          {car.vehicle.routeId &&
            `${data.routes.find((route) => route.id === car.vehicle.routeId)?.number ?? car.vehicle.routeId} · `}
          {data.routes.find((route) => route.id === car.vehicle.routeId)?.name ??
            t('header.routeNotSupplied')}
          {car.stale && t('viewer.stalePosition')}
        </p>
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
        {onFollow && (
          <>
            <button className="action-button follow-car" onClick={onFollow}>
              {t('stopDetails.unfollowValue', { value1: car.vehicle.label })}
            </button>
            {following && (
              <p className="microcopy">
                {car.stale
                  ? t('stopDetails.waitingForAFreshPositionBeforeMovingTheMap')
                  : car.vehicle.positionKind === 'next-station'
                    ? t('stopDetails.followingPredictedStationsPanOrZoomToPause')
                    : t('stopDetails.followingFreshGpsFixesPanOrZoomToPauseFollowing')}
              </p>
            )}
          </>
        )}
        {onJournal && (
          <div className="journal-car-actions">
            <button
              className="action-button"
              disabled={journalSaved || journalFull}
              onClick={onJournal}
            >
              {journalSaved
                ? t('stopDetails.inYourJournal')
                : journalFull
                  ? t('stopDetails.journalFull500Cars')
                  : t('stopDetails.addToJournal')}
            </button>
            {onOpenJournal && (
              <button className="text-button" onClick={onOpenJournal}>
                {t('stopDetails.openJournal')}
              </button>
            )}
            <p className="microcopy">
              {t('stopDetails.manuallyCollectThisCarNumberSavedInThisBrowserWithout')}
            </p>
          </div>
        )}
      </section>
    );
  if (!feature)
    return (
      <section id="details">
        <p className="eyebrow">{t('viewer.exploreToronto')}</p>
        <h1>{t('viewer.followTheCitySTracks')}</h1>
        <p>{t('viewer.fromLongBranchToTheBeachesExploreTheNetworkOne')}</p>
        <div className="stats">
          <div>
            <strong>{data.features.length}</strong>
            <small>{t('viewer.stopsTerminals')}</small>
          </div>
          <div>
            <strong>{data.routes.filter((route) => !route.overnight).length}</strong>
            <small>{t('viewer.daytimeRoutes')}</small>
          </div>
        </div>
        <p className="tip">
          {t('stopDetails.selectAStopTrainOrStreetcarForDetailsUseThe')}
        </p>
      </section>
    );
  const nearby = nearbyCars(data, feature, cars);
  const rapidRoutes = new Set(
    data.routes
      .filter((route) => /^(1|2|4|5|6)$/.test(route.number))
      .map((route) => route.id),
  );
  return (
    <section id="details" aria-live="polite">
      <p className="eyebrow">
        {feature.kind === 'terminal'
          ? t('viewer.stationTerminal')
          : t('stopDetails.transitStop')}
      </p>
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
