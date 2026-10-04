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
    mobilePanelOpen,
    picking,
    setFollowing,
    snakeOpen,
    setSnakeOpen,
    shortcutHelp,
    setShortcutHelp,
    shortcutsEnabled,
    setShortcutsEnabled,
    focusPoint,
    focusPointLevel,
    resetKey,
    theme,
    feed,
    cars,
    feature,
    car,
    locationPoint,
    comparisonStops,
    comparisonBounds,
    selectFeature,
    selectVehicle,
    previewMap,
    changeExportCars,
    closeExport,
    reset,
  } = workspace;
  const headerActions = (
    <div className="header-actions">
      <button
        className="shortcut-toggle"
        aria-label="Keyboard shortcuts"
        onClick={() => setShortcutHelp(true)}
      >
        ?
      </button>
      <button
        className="theme-toggle"
        aria-label={theme.dark ? 'Switch to day theme' : 'Switch to night theme'}
        onClick={theme.toggle}
      >
        {theme.dark ? '☀ Day' : '☾ Night'}
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
              Loading Streetcar Snake…
            </div>
          }
        >
          <SnakeGame
            data={data}
            cars={cars}
            feed={feed}
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
        actions={headerActions}
      />
      {data ? (
        <main className={`workspace${mobilePanelOpen ? ' mobile-panel-open' : ''}`}>
          <TransitMap
            mapTools={
              <button
                className="snake-launch"
                aria-label="Play Streetcar Snake"
                title="Play Streetcar Snake"
                onClick={() => setSnakeOpen(true)}
              >
                🐍
              </button>
            }
            data={data}
            cars={
              filters.live
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
            focusBounds={comparisonBounds}
            locationPoint={locationPoint}
            comparisonStops={panel === 'compare' ? comparisonStops : undefined}
            pickingLabel={
              picking
                ? `Choose a ${picking === 'from' ? 'start' : 'destination'} boarding stop`
                : undefined
            }
            onInteract={() => setFollowing(false)}
            onExport={previewMap}
            savedStopIds={savedStops}
            showLabels={filters.labels}
            includeOvernight={filters.overnight}
            showStreetcar={filters.streetcar}
            showSubway={filters.subway}
            resetKey={resetKey}
            onSelectFeature={selectFeature}
            onSelectVehicle={(car) => selectVehicle(car)}
          />
          <HomeSidebar workspace={workspace} />
        </main>
      ) : (
        <main className="loading-page">
          <h1>TTC status map</h1>
          <p role={error ? 'alert' : 'status'}>
            {error ?? 'Loading the streetcar network…'}
          </p>
          {error && <button onClick={() => retryMap()}>Try again</button>}
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
