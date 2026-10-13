import { SelectionDetails } from './SelectionDetails';
import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { NearbyStops } from '../../stops/NearbyStops';
import { trackEvent } from '../../../analytics';
import { SegmentedControl } from '../../../components/SegmentedControl';
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
    feed,
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
  const railMode =
    filters.subway && !filters.streetcar
      ? 'subway'
      : filters.streetcar && !filters.subway
        ? 'streetcar'
        : 'both';
  const liveMode = !filters.live
    ? 'off'
    : filters.serviceOverlay
      ? 'service'
      : 'vehicles';
  return (
    <div
      id="panel-explore"
      role="tabpanel"
      aria-label={t('workspace.exploreTools')}
      hidden={panel !== 'explore'}
    >
      <div className="explore-layers" aria-label={t('workspace.exploreRailLayers')}>
        <SegmentedControl
          label={t('workspace.railLayers')}
          value={railMode}
          options={[
            { value: 'subway', label: t('workspace.subwayOnly') },
            { value: 'streetcar', label: t('workspace.streetcarOnly') },
            { value: 'both', label: t('workspace.both') },
          ]}
          onChange={(value) =>
            setFilters({
              ...filters,
              subway: value !== 'streetcar',
              streetcar: value !== 'subway',
            })
          }
        />
        <div title={feed.failed ? t('mapFilters.liveVehiclesUnavailable') : undefined}>
          <SegmentedControl
            label={t('workspace.liveMapMode')}
            value={liveMode}
            options={[
              { value: 'off', label: t('workspace.off') },
              { value: 'vehicles', label: t('workspace.vehiclesOnly') },
              { value: 'service', label: t('workspace.serviceOverlay') },
            ]}
            onChange={(value) => {
              const live = value !== 'off';
              setFilters({ ...filters, live, serviceOverlay: value === 'service' });
              if (!live && selection?.kind === 'car') {
                pendingCar.current = undefined;
                setFollowing(false);
                setSelection(
                  selectedRoute ? { kind: 'route', id: selectedRoute } : undefined,
                );
              }
            }}
          />
        </div>
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
