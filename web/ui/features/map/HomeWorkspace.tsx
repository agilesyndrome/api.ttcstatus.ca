import { usePhoneLayout } from '../../hooks/useMediaQuery';
import { MobileDetails } from './MobileDetails';
import { CachedMapNotice } from './CachedMapNotice';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { HomeSidebar } from './HomeSidebar';
import { BadgesPanel } from './panels/BadgesPanel';
import { ExplorePanel } from './panels/ExplorePanel';
import { JournalPanel } from './panels/JournalPanel';
import { RoutePulsePanel } from './panels/RoutePulsePanel';
import { SelectionDetails } from './panels/SelectionDetails';
import { lazy, Suspense } from 'react';

import { Nav, useCompactNav } from '../../components/nav/Nav';
import { navLogos } from '../../components/nav/NavPanel';
import { PageHeader } from '../../components/page/PageHeader';
import { PageFooter } from '../../components/page/PageFooter';

import { SlaPanel } from './panels/SlaPanel';
import { TransitMap } from '../map/TransitMap';

import { KeyboardHelp } from '../../components/KeyboardHelp';

import { MapExport } from '../export/MapExport';
import { AuthControls } from '../accounts/auth';

import { useServiceOverlay } from '../service/ServiceLayer';
import { STATE_COLORS } from '../service/wave-field';

import type { HomeWorkspaceState } from './useHomeWorkspace';

const SnakeGame = lazy(() =>
  import('../snake/SnakeGame').then((module) => ({ default: module.SnakeGame })),
);

export function HomeWorkspace({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const {
    data,
    error,
    retryMap,
    filters,
    savedStops,
    exportImage,
    exportCars,
    selectedRoute,
    panel,
    setPanel,
    mobilePanelOpen,
    setMobilePanelOpen,
    following,
    setFollowing,
    snakeOpen,
    setSnakeOpen,
    shortcutHelp,
    setShortcutHelp,
    shortcutsEnabled,
    setShortcutsEnabled,
    focusPoint,
    focusPointLevel,
    focusBounds,
    resetKey,
    cars,
    feature,
    car,
    locationPoint,
    locating,
    locateError,
    requestLocate,
    selectFeature,
    selectVehicle,
    changeExportCars,
    closeExport,
    reset,
  } = workspace;
  const selectedDayRoutes = feature?.routeIds.filter(
    (id) => !data?.routes.find((route) => route.id === id)?.overnight,
  );
  const visualRoute =
    car?.vehicle.routeId ??
    selectedRoute ??
    (filters.serviceOverlay && selectedDayRoutes?.length === 1
      ? selectedDayRoutes[0]
      : undefined);
  // The per-user-gated service layer (docs/sla.md §5.2 + the polish epic):
  // flag off or signed out → nothing renders and no /service/* requests are
  // made. Hard-suspended while the snake game is open (E7S7) — the game
  // renders its own map with no service props, and the base layer sleeps.
  const service = useServiceOverlay(
    data,
    cars,
    snakeOpen,
    filters.live && !!filters.serviceOverlay,
    () => {
      workspace.setSelection(undefined);
      workspace.setFocusPoint(undefined);
      workspace.setFollowing(false);
    },
    visualRoute,
    feature,
  );
  const compact = useCompactNav();
  const phone = usePhoneLayout();
  const selectFeatureWithService = (feature: Parameters<typeof selectFeature>[0]) => {
    selectFeature(feature);
    service.onFeatureSelectForService(feature);
  };
  const resetWithService = () => {
    reset();
    service.onFeatureSelectForService(null);
  };
  const headerActions = (
    <div className="header-actions">
      <a
        className="utility-button"
        href="/settings"
        aria-label={t('navigation.settings')}
        title={t('navigation.settings')}
      >
        {navLogos.settings}
      </a>
      {/* The globe is a shortcut to Settings → language (/settings#language);
       * the day/night control lives in Settings itself. */}
      <a
        className="utility-button language-link"
        href="/settings#language"
        aria-label={t('language.settings')}
        title={t('language.settings')}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7" />
          <path d="M3 10h14M10 3c2 2 3 4.4 3 7s-1 5-3 7c-2-2-3-4.4-3-7s1-5 3-7Z" />
        </svg>
      </a>
      <button
        type="button"
        className="utility-button shortcut-toggle"
        aria-label={t('keyboard.title')}
        onClick={() => setShortcutHelp(true)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <AuthControls />
    </div>
  );
  return (
    <>
      {snakeOpen && data && (
        <Suspense
          fallback={
            <div className="snake-loading" role="status">
              {t('workspace.loadingStreetcarSnake')}
            </div>
          }
        >
          <SnakeGame
            data={data}
            cars={cars}
            onClose={() => {
              setSnakeOpen(false);
              requestAnimationFrame(() =>
                document.querySelector<HTMLButtonElement>('.snake-launch')?.focus(),
              );
            }}
          />
        </Suspense>
      )}
      {/* The rail keeps destinations and map controls in one place. Each data
       * destination uses the main pane; Explore keeps the map mounted. */}
      <Nav
        variant="map"
        panel={panel}
        onPanel={setPanel}
        panels={{
          explore: <ExplorePanel workspace={workspace} />,
        }}
      >
        <PageHeader
          data={data}
          cars={cars}
          onSelect={selectFeatureWithService}
          onSelectVehicle={(car) => selectVehicle(car, true)}
          onReset={resetWithService}
          actions={null}
          onBrandToggle={() => {
            // The brand symbol is the mobile menu button: it opens the nav
            // panel over the map. On desktop it keeps its old meaning — a
            // reset — because the full menu stays visible beside the map.
            if (phone) setMobilePanelOpen((open) => !open);
            else resetWithService();
          }}
          navOpen={mobilePanelOpen}
        />
        {data ? (
          <main className={`workspace${mobilePanelOpen ? ' mobile-panel-open' : ''}`}>
            <div className="workspace-map" hidden={panel !== 'explore'}>
              <TransitMap
                mapTools={
                  <>
                    <button
                      className="locate-launch"
                      aria-label={t('nearbyStops.locateMeCenterMap')}
                      title={t('nearbyStops.locateMeCenterMap')}
                      aria-busy={locating}
                      onClick={requestLocate}
                      disabled={locating}
                    >
                      ◎
                      {locating && (
                        <span className="sr-only" role="status">
                          {t('nearbyStops.findingYourLocation')}
                        </span>
                      )}
                    </button>
                    {locateError && (
                      <p role="alert" className="locate-error">
                        {t(locateError)}
                      </p>
                    )}
                    <button
                      className="snake-launch"
                      aria-label={t('workspace.playStreetcarSnake')}
                      title={t('workspace.playStreetcarSnake')}
                      onClick={() => setSnakeOpen(true)}
                    >
                      🐍
                    </button>
                  </>
                }
                data={data}
                followPoint={car && following ? car.point : undefined}
                cars={
                  // A followed car gets the map to itself; anything else unfollows.
                  car && following
                    ? [car]
                    : filters.live
                      ? cars.filter((car) =>
                          car.vehicle.mode === 'subway'
                            ? filters.subway
                            : filters.streetcar,
                        )
                      : []
                }
                selectedRoute={selectedRoute}
                highlightRoute={visualRoute}
                serviceMode={Boolean(service.underlay)}
                selectedFeature={feature}
                selectedVehicleId={car?.vehicle.id}
                focusPoint={focusPoint}
                focusPointLevel={focusPointLevel}
                focusBounds={focusBounds}
                locationPoint={locationPoint}
                comparisonStops={undefined}
                pickingLabel={undefined}
                onInteract={() => setFollowing(false)}
                onZoomInteract={() => {
                  /* Zooming keeps camera following; only panning takes over. */
                }}
                mapControls={false}
                mapPopup={workspace.selection ? null : service.card}
                savedStopIds={savedStops}
                showLabels={filters.labels}
                includeOvernight={filters.overnight}
                showStreetcar={filters.streetcar}
                showSubway={filters.subway}
                resetKey={resetKey}
                onSelectFeature={selectFeatureWithService}
                onSelectVehicle={(car) => selectVehicle(car)}
                onSelectServiceStop={service.onSelectServiceStop}
                serviceCarTint={service.carTint}
                underlay={service.underlay ?? undefined}
                overlay={service.overlay ?? undefined}
              />
              <CachedMapNotice workspace={workspace} />
              {service.underlay && (
                <div className="map-service-legend" aria-label="Service colours">
                  <strong>Service on tracks</strong>
                  {(
                    [
                      ['fresh', 'Recently served'],
                      ['due', 'Getting due'],
                      ['void', 'Service gap'],
                      ['unmonitored', 'No data'],
                    ] as const
                  ).map(([state, label]) => (
                    <span key={state}>
                      <i style={{ background: STATE_COLORS[state] }} />
                      {label}
                    </span>
                  ))}
                </div>
              )}
              {!compact && (workspace.selection || workspace.notice) && (
                <aside
                  className="workspace-details"
                  aria-label={t('workspace.stopAndRouteDetails')}
                >
                  {feature && !car && service.card}
                  <SelectionDetails
                    workspace={workspace}
                    serviceMode={Boolean(feature && !car && service.card)}
                  />
                </aside>
              )}
              {compact && (
                <MobileDetails
                  workspace={workspace}
                  serviceCard={feature && !car ? service.card : null}
                />
              )}
            </div>
            {panel !== 'explore' && (
              <section
                className="workspace-view"
                aria-label={
                  panel === 'route-pulse'
                    ? t('routePulse.routePulse')
                    : panel === 'journal'
                      ? t('navigation.journal')
                      : panel === 'badges'
                        ? t('navigation.badges')
                        : t('navigation.status')
                }
              >
                {panel === 'route-pulse' && <RoutePulsePanel workspace={workspace} />}
                {panel === 'journal' && <JournalPanel workspace={workspace} />}
                {panel === 'badges' && <BadgesPanel workspace={workspace} />}
                {panel === 'sla' && <SlaPanel workspace={workspace} />}
              </section>
            )}
            {/* Compact screens open the same navigation and Explore controls
             * over the main pane. */}
            {compact && <HomeSidebar workspace={workspace} settings={headerActions} />}
          </main>
        ) : (
          <main className="loading-page">
            <h1>{t('header.ttcStatusMap')}</h1>
            <p role={error ? 'alert' : 'status'}>
              {error ? t(error) : t('workspace.loadingTheStreetcarNetwork')}
            </p>
            {error && <button onClick={() => retryMap()}>{t('common.retry')}</button>}
            <PageFooter />
          </main>
        )}
      </Nav>
      <MapExport
        image={exportImage}
        includeCars={exportCars}
        onCars={changeExportCars}
        onClose={closeExport}
      />
      <KeyboardHelp
        open={shortcutHelp}
        enabled={shortcutsEnabled}
        onEnabled={setShortcutsEnabled}
        onClose={() => setShortcutHelp(false)}
      />
    </>
  );
}
