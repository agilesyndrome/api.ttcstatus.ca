import { useState } from 'react';
import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { trackEvent } from '../../../analytics';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { clearDefaultView, hasDefaultView, writeDefaultView } from '../default-view';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** Explore contains actions that change the map; selected data stays in the main pane. */
export function ExplorePanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  // The device's default view lives in a cookie, read synchronously; the
  // local mirror keeps the three-state tool honest between renders.
  const [hasDefault, setHasDefault] = useState(hasDefaultView);
  const {
    data,
    savedStops,
    recentStopIds,
    selectFeature,
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
    mapControls,
  } = workspace;
  if (!data) return null;
  const saveDefault = () => {
    const camera = mapControls?.current?.camera();
    if (!camera) return;
    writeDefaultView(
      camera,
      {
        streetcar: filters.streetcar,
        subway: filters.subway,
        live: filters.live,
        serviceOverlay: Boolean(filters.serviceOverlay),
      },
      data.bounds,
    );
    setHasDefault(hasDefaultView());
    trackEvent('saved-default-view');
  };
  const resetDefault = () => {
    clearDefaultView();
    setHasDefault(false);
    mapControls?.current?.reland();
    trackEvent('reset-default-view');
  };
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
  const featureById = new Map(data.features.map((feature) => [feature.id, feature]));
  const saved = savedStops
    .flatMap((id) => {
      const feature = featureById.get(id);
      return feature ? [feature] : [];
    })
    .slice(-3)
    .reverse();
  const recent = recentStopIds
    .filter((id) => !savedStops.includes(id))
    .flatMap((id) => {
      const feature = featureById.get(id);
      return feature ? [feature] : [];
    })
    .slice(0, 3);
  const stopShortcut = (feature: (typeof saved)[number]) => (
    <li key={feature.id}>
      <button
        className="explore-shortcuts__stop"
        aria-current={
          selection?.kind === 'stop' && selection.id === feature.id ? 'true' : undefined
        }
        onClick={() => selectFeature(feature)}
      >
        <span>{feature.name}</span>
        <small>
          {feature.routeIds
            .map((id) => data.routes.find((route) => route.id === id)?.number)
            .filter(Boolean)
            .slice(0, 3)
            .join(' · ')}
        </small>
      </button>
    </li>
  );
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
      {(saved.length > 0 || recent.length > 0) && (
        <div className="explore-shortcuts">
          {saved.length > 0 && (
            <section aria-label={t('myStops.savedStops')}>
              <h3>{t('myStops.savedStops')}</h3>
              <ul>{saved.map(stopShortcut)}</ul>
            </section>
          )}
          {recent.length > 0 && (
            <section aria-label={t('workspace.recentStops')}>
              <h3>{t('workspace.recentStops')}</h3>
              <ul>{recent.map(stopShortcut)}</ul>
            </section>
          )}
        </div>
      )}
      <div className="explore-tools">
        {hasDefault ? (
          <>
            <button className="action-button" onClick={saveDefault}>
              {t('workspace.updateDefaultMapView')}
            </button>
            <button
              className="action-button"
              onClick={resetDefault}
              title={t('workspace.resetDefaultMapViewTitle')}
            >
              {t('workspace.resetDefaultMapView')}
            </button>
          </>
        ) : (
          <button
            className="action-button"
            onClick={saveDefault}
            title={t('workspace.saveDefaultMapViewTitle')}
          >
            {t('workspace.saveDefaultMapView')}
          </button>
        )}
        <button className="action-button explore-tools__surprise" onClick={surprise}>
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
