import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { MapFilters } from '../MapFilters';
import { RouteGuide } from '../RouteGuide';
import { LiveFeedStatus } from '../LiveFeedStatus';
import { StopDetails } from '../../stops/StopDetails';
import { NearbyStops } from '../../stops/NearbyStops';
import { RoutePulse } from '../RoutePulse';
import { ShareMap } from '../../export/ShareMap';
import { trackEvent } from '../../../analytics';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The map workspace's Explore content, shared by the rail and mobile drawer. */
export function ExplorePanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const {
    data,
    filters,
    setFilters,
    savedStops,
    selection,
    setSelection,
    selectedRoute,
    setSelectedRoute,
    setMobilePanelOpen,
    following,
    setFollowing,
    setFocusPoint,
    location,
    setLocation,
    notice,
    pendingCar,
    feed,
    cars,
    feature,
    car,
    selectFeature,
    selectVehicle,
    selectRoute,
    surprise,
    toggleSave,
    previewMap,
    shownRoutes,
    panel,
  } = workspace;
  if (!data) return null;
  const guideRoute = data.routes.find((route) => route.id === selectedRoute);
  return (
    <div
      id="panel-explore"
      role="tabpanel"
      aria-label={t('workspace.exploreTools')}
      hidden={panel !== 'explore'}
    >
      <div className="explore-tools">
        <button className="action-button surprise-button" onClick={surprise}>
          {t('workspace.surpriseMe')}
        </button>
        <ShareMap
          selection={selection}
          filters={filters}
          contextRoute={selectedRoute}
          tools={{ panel }}
        />
        <button
          className="action-button"
          onClick={() => {
            trackEvent('exported-map');
            previewMap();
          }}
        >
          {t('map.export')}
        </button>
      </div>
      <div className="explore-layers" aria-label={t('workspace.exploreRailLayers')}>
        <button
          className={`layer-toggle ${filters.streetcar ? 'is-on' : ''}`}
          aria-pressed={filters.streetcar}
          onClick={() => setFilters({ ...filters, streetcar: !filters.streetcar })}
        >
          <span aria-hidden="true" /> {t('workspace.streetcar')}{' '}
          {filters.streetcar ? t('workspace.on') : t('workspace.off')}
        </button>
        <button
          className={`layer-toggle ${filters.subway ? 'is-on' : ''}`}
          aria-pressed={filters.subway}
          onClick={() => setFilters({ ...filters, subway: !filters.subway })}
        >
          <span aria-hidden="true" /> {t('workspace.subway')}{' '}
          {filters.subway ? t('workspace.on') : t('workspace.off')}
        </button>
      </div>
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
            onFollow={car && following ? () => setFollowing(false) : undefined}
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
      <NearbyStops
        data={data}
        location={location}
        onClear={() => {
          setLocation(undefined);
          setFocusPoint(undefined);
        }}
        onSelect={selectFeature}
      />
      <MapFilters
        value={filters}
        onChange={(next) => {
          setFilters(next);
          if (!next.live && selection?.kind === 'car') {
            pendingCar.current = undefined;
            setFollowing(false);
            setSelection(
              selectedRoute ? { kind: 'route', id: selectedRoute } : undefined,
            );
          }
          if (
            !next.overnight &&
            data.routes.find((route) => route.id === selectedRoute)?.overnight
          ) {
            setSelectedRoute(undefined);
            if (selection?.kind === 'route') setSelection(undefined);
          }
        }}
      />
      <LiveFeedStatus {...feed} />
      <RoutePulse
        routes={shownRoutes}
        cars={cars}
        loaded={Boolean(feed.snapshot)}
        active={feed.active}
        failed={feed.failed}
        selectedRoute={selectedRoute}
        onSelect={(id) => selectRoute(selectedRoute === id ? undefined : id)}
      />
    </div>
  );
}
