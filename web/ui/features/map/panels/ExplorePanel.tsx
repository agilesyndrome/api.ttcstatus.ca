import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { trackEvent } from '../../../analytics';
import { SegmentedControl } from '../../../components/SegmentedControl';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** Explore contains actions that change the map; selected data stays in the main pane. */
export function ExplorePanel({ workspace }: { workspace: HomeWorkspaceState }) {
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
    pendingCar,
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
  const railModeLabel =
    railMode === 'subway'
      ? t('workspace.subwayOnly')
      : railMode === 'streetcar'
        ? t('workspace.streetcarOnly')
        : t('workspace.both');
  const liveModeLabel =
    liveMode === 'service'
      ? t('workspace.serviceOverlay')
      : liveMode === 'vehicles'
        ? t('workspace.vehiclesOnly')
        : t('workspace.off');
  return (
    <div
      id="panel-explore"
      role="tabpanel"
      aria-label={t('workspace.exploreTools')}
      hidden={panel !== 'explore'}
    >
      <details className="explore-settings">
        <summary>
          <span>{t('navigation.mapTools')}</span>
          <small>
            {railModeLabel} · {liveModeLabel}
          </small>
        </summary>
        <div className="explore-layers" aria-label={t('workspace.exploreRailLayers')}>
          <span className="explore-control-label">{t('workspace.railLayers')}</span>
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
            <span className="explore-control-label">{t('workspace.liveMapMode')}</span>
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
      </details>
      <div className="explore-tools">
        <button className="action-button explore-tools__primary" onClick={surprise}>
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
