import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { HomeSidebar } from './HomeSidebar';
import { lazy, Suspense } from 'react';

import { PageHeader } from '../../components/PageHeader';
import { PageFooter } from '../../components/PageFooter';

import { TransitMap } from '../map/TransitMap';

import { KeyboardHelp } from '../../components/KeyboardHelp';

import { MapExport } from '../export/MapExport';
import { AuthControls } from '../accounts/auth';

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
    theme,
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
  const headerActions = (
    <div className="header-actions">
      <a
        className="account-link language-link"
        href="/profile"
        aria-label={t('language.settings')}
        title={t('language.settings')}
      >
        🌐
      </a>
      <button
        className="shortcut-toggle"
        aria-label={t('keyboard.title')}
        onClick={() => setShortcutHelp(true)}
      >
        ?
      </button>
      <button
        className="theme-toggle"
        aria-label={
          theme.dark ? t('workspace.switchToDayTheme') : t('workspace.switchToNightTheme')
        }
        onClick={theme.toggle}
      >
        {theme.dark ? t('workspace.day') : t('workspace.night')}
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
      <PageHeader
        data={data}
        cars={cars}
        onSelect={selectFeature}
        onSelectVehicle={(car) => selectVehicle(car, true)}
        onReset={reset}
        onBrandToggle={() => {
          // The brand symbol is the mobile menu button: it opens the nav
          // panel over the map. On desktop it keeps its old meaning — a
          // reset — because the full menu stays visible beside the map.
          if (window.matchMedia('(max-width: 640px)').matches)
            setMobilePanelOpen((open) => !open);
          else reset();
        }}
        navOpen={mobilePanelOpen}
        actions={headerActions}
      />
      {data ? (
        <main className={`workspace${mobilePanelOpen ? ' mobile-panel-open' : ''}`}>
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
                      car.vehicle.mode === 'subway' ? filters.subway : filters.streetcar,
                    )
                  : []
            }
            selectedRoute={selectedRoute}
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
            savedStopIds={savedStops}
            showLabels={filters.labels}
            includeOvernight={filters.overnight}
            showStreetcar={filters.streetcar}
            showSubway={filters.subway}
            resetKey={resetKey}
            onSelectFeature={selectFeature}
            onSelectVehicle={(car) => selectVehicle(car)}
          />
          <HomeSidebar workspace={workspace} settings={headerActions} />
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
