import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { RouteGuide } from '../RouteGuide';
import { StopDetails } from '../../stops/StopDetails';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** One details renderer, hosted by the desktop rail or the separate phone card. */
export function SelectionDetails({
  workspace,
  serviceMode = false,
}: {
  workspace: HomeWorkspaceState;
  serviceMode?: boolean;
}) {
  useLanguage();
  const {
    data,
    notice,
    selection,
    feed,
    savedStops,
    selectFeature,
    feature,
    car,
    cars,
    filters,
    toggleSave,
    following,
    setFollowing,
    selectVehicle,
    pendingCar,
    setSelection,
    setFocusPoint,
    setMobilePanelOpen,
    selectedRoute,
    selectRoute,
  } = workspace;
  if (!data) return null;
  const guideRoute = data.routes.find((route) => route.id === selectedRoute);
  return (
    <>
      {notice && (
        <p role="status" className="tip">
          {t(notice)}
        </p>
      )}
      {selection?.kind === 'car' && !car && (
        <p role="status" className="tip">
          {feed.snapshot
            ? t('workspace.carValueIsNotInTheLatestVehicleFeedIt', {
                value1: selection.id,
              })
            : feed.failed
              ? t('workspace.livePositionsUnavailableThisStreetcarWillAppearWhenTheFeed')
              : t('workspace.waitingForThisStreetcarSLivePosition')}
        </p>
      )}
      {guideRoute && (
        <div hidden={selection?.kind !== 'route'}>
          <RouteGuide
            key={guideRoute.id}
            data={data}
            route={guideRoute}
            savedIds={savedStops}
            onSelect={selectFeature}
            onClose={() => selectRoute(undefined)}
          />
        </div>
      )}
      {(!guideRoute || selection?.kind !== 'route') && (
        <>
          {guideRoute && feature && (
            <button
              className="text-button back-to-route"
              onClick={() => selectRoute(guideRoute.id)}
            >
              {t('workspace.backToValueStops', { route: guideRoute.number })}
            </button>
          )}
          <StopDetails
            data={data}
            feature={feature}
            serviceMode={serviceMode}
            car={car}
            cars={cars}
            saved={Boolean(feature && savedStops.includes(feature.id))}
            saveLimit={savedStops.length >= 100}
            liveEnabled={filters.live}
            feedLoaded={Boolean(feed.snapshot)}
            feedFailed={feed.failed}
            snapshot={feed.snapshot}
            now={feed.now}
            onToggleSave={feature ? toggleSave : undefined}
            following={following}
            onFollow={car ? () => setFollowing(!following) : undefined}
            onSelectVehicle={(car) => selectVehicle(car, true)}
            onClose={() => {
              pendingCar.current = undefined;
              setSelection(undefined);
              setFocusPoint(undefined);
              setFollowing(false);
              setMobilePanelOpen(false);
              if (window.matchMedia('(max-width: 640px)').matches)
                document.getElementById('map')?.focus();
            }}
          />
        </>
      )}
    </>
  );
}
