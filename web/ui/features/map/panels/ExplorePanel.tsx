import { SelectionDetails } from './SelectionDetails';
import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { NearbyStops } from '../../stops/NearbyStops';
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
    setFollowing,
    setFocusPoint,
    location,
    setLocation,
    pendingCar,
    selectFeature,
    surprise,
    previewMap,
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
        <button
          className={`layer-toggle ${filters.live ? 'is-on' : ''}`}
          aria-pressed={filters.live}
          onClick={() => {
            const live = !filters.live;
            setFilters({ ...filters, live });
            if (!live && selection?.kind === 'car') {
              pendingCar.current = undefined;
              setFollowing(false);
              setSelection(
                selectedRoute ? { kind: 'route', id: selectedRoute } : undefined,
              );
            }
          }}
        >
          <span aria-hidden="true" /> {t('mapFilters.showLiveVehicles')}{' '}
          {filters.live ? t('workspace.on') : t('workspace.off')}
        </button>
      </div>
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
      <div className="explore-tools">
        <button className="action-button" onClick={surprise}>
          {t('workspace.surpriseMe')}
        </button>
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
    </div>
  );
}
