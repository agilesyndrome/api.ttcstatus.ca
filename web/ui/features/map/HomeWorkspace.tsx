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
import { ReplayPanel } from '../replay/ReplayPanel';
import { ReplayOverlay } from '../replay/ReplayOverlay';
import { ReplayCarCard } from '../replay/ReplayCarCard';
import { TransitMap } from '../map/TransitMap';

import { KeyboardHelp } from '../../components/KeyboardHelp';

import { MapExport } from '../export/MapExport';
import { AuthControls } from '../accounts/auth';

import { useServiceOverlay } from '../service/ServiceLayer';
import { useTheme } from '../../hooks/useTheme';
import { useColourMode } from '../../hooks/useColourMode';
import { LegendBar } from '../service/LegendBar';
import { RouteColourKey } from './RouteColourKey';

import type { HomeWorkspaceState } from './useHomeWorkspace';

const SnakeGame = lazy(() =>
  import('../snake/SnakeGame').then((module) => ({ default: module.SnakeGame })),
);

export function HomeWorkspace({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const { dark } = useTheme();
  const { colourMode } = useColourMode();
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
    mapControls,
    replay,
    replayFocus,
    setReplayFocus,
    accountJournal,
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
  const compact = useCompactNav();
  const phone = usePhoneLayout();
  // Replay (docs/replay.md): the map itself is the screen. While the
  // Replay destination is open the workspace swaps the live feed's cars
  // for the engine's interpolated historical ones, sleeps the service
  // overlay, and floats the frame clock + scrubber over the map; the rail
  // panel beside it is the remote. A tap focuses — a car solos and the
  // camera follows it through time, a track focuses its route and dims
  // the rest. Members-only: a signed-out deep link renders the sign-in
  // gate and never touches the screen.
  const signedIn = Boolean(accountJournal.userId);
  const replayActive = panel === 'replay' && signedIn;
  const focusedCar =
    replayFocus?.kind === 'car'
      ? replay.cars.find((car) => car.vehicle.id === replayFocus.id)
      : undefined;
  const focusedRouteId = replayFocus?.kind === 'route' ? replayFocus.id : undefined;
  const replayCars = replay.cars.filter((car) =>
    car.vehicle.mode === 'subway' ? filters.subway : filters.streetcar,
  );
  const focusedRoute = focusedRouteId
    ? data?.routes.find((route) => route.id === focusedRouteId)
    : undefined;
  // The per-user-gated service layer (docs/sla.md §5.2 + the polish epic):
  // flag off or signed out → nothing renders and no /service/* requests are
  // made. Hard-suspended while the snake game is open (E7S7) — the game
  // renders its own map with no service props, and the base layer sleeps.
  // Replay also sleeps it: the screen shows the historical fleet.
  const service = useServiceOverlay(
    data,
    cars,
    snakeOpen,
    filters.live && !!filters.serviceOverlay && !replayActive,
    () => {
      workspace.setSelection(undefined);
      workspace.setFocusPoint(undefined);
      workspace.setFollowing(false);
    },
    visualRoute,
    feature,
    dark ? 'dark' : 'light',
    colourMode,
  );
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
          replay: <ReplayPanel workspace={workspace} />,
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
            <div
              className={`workspace-map${replayActive ? ' replaying' : ''}`}
              hidden={panel !== 'explore' && !replayActive}
            >
              <TransitMap
                controlsRef={mapControls}
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
                followPoint={
                  replayActive && focusedCar
                    ? focusedCar.point
                    : car && following
                      ? car.point
                      : undefined
                }
                cars={
                  // Replaying: the engine's interpolated historical fleet,
                  // filtered by the same mode toggles (the live layer's
                  // on/off switch does not gate the replay screen). A
                  // focused car solos; a focused route hides the other
                  // routes' cars. Live: a followed car gets the map to
                  // itself; anything else unfollows.
                  replayActive
                    ? focusedCar
                      ? [focusedCar]
                      : focusedRouteId
                        ? replayCars.filter(
                            (car) => car.vehicle.routeId === focusedRouteId,
                          )
                        : replayCars
                    : car && following
                      ? [car]
                      : filters.live
                        ? cars.filter((car) =>
                            car.vehicle.mode === 'subway'
                              ? filters.subway
                              : filters.streetcar,
                          )
                        : []
                }
                selectedRoute={replayActive ? focusedRouteId : selectedRoute}
                highlightRoute={replayActive ? focusedRouteId : visualRoute}
                serviceMode={Boolean(service.underlay)}
                selectedFeature={feature}
                selectedVehicleId={
                  replayActive ? focusedCar?.vehicle.id : car?.vehicle.id
                }
                focusPoint={focusPoint}
                focusPointLevel={focusPointLevel}
                focusBounds={focusBounds}
                locationPoint={locationPoint}
                comparisonStops={undefined}
                pickingLabel={undefined}
                onInteract={() => {
                  // Panning hands control back: unfollow the live car, and
                  // on the replay screen return the whole network.
                  if (replayActive) setReplayFocus(undefined);
                  else setFollowing(false);
                }}
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
                onSelectFeature={(feature) => {
                  // Map taps stay inert while watching a replay — selecting
                  // a stop would leave the TV for the explorer.
                  if (!replayActive) selectFeatureWithService(feature);
                }}
                onSelectVehicle={(selected) => {
                  if (!replayActive) {
                    selectVehicle(selected);
                    return;
                  }
                  // Replay taps: a car solos and the camera follows it
                  // through time; tapping the soloed car again hands the
                  // focus back to its whole route.
                  setReplayFocus((current) =>
                    current?.kind === 'car' && current.id === selected.vehicle.id
                      ? { kind: 'route', id: selected.vehicle.routeId ?? '' }
                      : { kind: 'car', id: selected.vehicle.id },
                  );
                }}
                onSelectRoute={
                  replayActive
                    ? (routeId) =>
                        setReplayFocus((current) =>
                          current?.kind === 'route' && current.id === routeId
                            ? undefined
                            : { kind: 'route', id: routeId },
                        )
                    : undefined
                }
                serviceCarTint={service.carTint}
                underlay={service.underlay ?? undefined}
              />
              <CachedMapNotice workspace={workspace} />
              {service.underlay ? (
                <LegendBar theme={dark ? 'dark' : 'light'} colourMode={colourMode} />
              ) : (
                <RouteColourKey
                  routes={data.routes.filter(
                    (route) =>
                      (filters.overnight || !route.overnight) &&
                      (filters.streetcar || /^(1|2|4|5|6)$/.test(route.number)),
                  )}
                />
              )}
              {!compact &&
                (workspace.selection ||
                  workspace.notice ||
                  (replayActive && focusedCar)) && (
                  <aside
                    className="workspace-details"
                    aria-label={t('workspace.stopAndRouteDetails')}
                  >
                    {replayActive && focusedCar ? (
                      // The followed replay car's card: its recorded stops
                      // and the times the recorder wrote down.
                      <ReplayCarCard
                        replay={replay}
                        car={focusedCar}
                        routes={data.routes}
                        onClose={() => setReplayFocus(undefined)}
                      />
                    ) : (
                      <>
                        {feature && !car && service.card}
                        <SelectionDetails
                          workspace={workspace}
                          serviceMode={Boolean(feature && !car && service.card)}
                        />
                      </>
                    )}
                  </aside>
                )}
              {compact && (
                <MobileDetails
                  workspace={workspace}
                  serviceCard={feature && !car ? service.card : null}
                />
              )}
              {/* The replay screen furniture: frame clock, transport and
               * scrubber, floating over the historical map — plus the
               * focused route's chip while a route owns the screen. */}
              {replayActive && (
                <ReplayOverlay
                  replay={replay}
                  routeNumber={focusedRoute?.number}
                  onClearFocus={() => setReplayFocus(undefined)}
                />
              )}
            </div>
            {panel !== 'explore' && !replayActive && (
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
