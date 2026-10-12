import { SelectionDetails } from './SelectionDetails';
import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { MapFilters } from '../MapFilters';
import { LiveFeedStatus } from '../LiveFeedStatus';
import { NearbyStops } from '../../stops/NearbyStops';
import { RoutePulse } from '../RoutePulse';
import { ShareMap } from '../../export/ShareMap';
import { trackEvent } from '../../../analytics';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The map workspace's Explore content, shared by the rail and mobile drawer. */
export function ExplorePanel({
  workspace,
  showDetails = true,
}: {
  workspace: HomeWorkspaceState;
  showDetails?: boolean;
}) {
  useLanguage();
  const {
    data,
    filters,
    setFilters,
    selection,
    setSelection,
    selectedRoute,
    setSelectedRoute,
    setFollowing,
    setFocusPoint,
    location,
    setLocation,
    pendingCar,
    feed,
    cars,
    selectFeature,
    selectRoute,
    surprise,
    previewMap,
    shownRoutes,
    panel,
  } = workspace;
  if (!data) return null;
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
      {workspace.savedCached && (
        <p role="status" className="account-cache-status">
          {t('cache.accountOffline')}
        </p>
      )}
      {showDetails && <SelectionDetails workspace={workspace} />}
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
