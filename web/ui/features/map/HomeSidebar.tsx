import { PageFooter } from '../../components/PageFooter';
import { MapFilters } from '../map/MapFilters';
import { RouteLegend } from '../map/RouteLegend';
import { LiveFeedStatus } from '../map/LiveFeedStatus';

import { StopDetails } from '../stops/StopDetails';
import { MyStops } from '../stops/MyStops';
import { NearbyStops } from '../stops/NearbyStops';
import { RoutePulse } from '../map/RoutePulse';
import { ShareMap } from '../export/ShareMap';
import { FleetExplorer } from '../fleet/FleetExplorer';
import { StopComparison } from '../comparison/StopComparison';
import { SidebarTabs } from '../../components/SidebarTabs';

import { StopBrowser } from '../stops/StopBrowser';
import { StreetcarJournal } from '../journal/StreetcarJournal';
import { JOURNAL_LIMIT } from '../../../../shared/accounts/journal';

import { AccountRequired } from '../accounts/auth';

import type { HomeWorkspaceState } from './useHomeWorkspace';

export function HomeSidebar({ workspace }: { workspace: HomeWorkspaceState }) {
  const {
    data,
    filters,
    setFilters,
    savedStops,
    setSavedStops,
    savedPersistent,
    accountJournal,
    journal,
    setJournal,
    selection,
    setSelection,
    selectedRoute,
    setSelectedRoute,
    panel,
    setPanel,
    mobilePanelOpen,
    setMobilePanelOpen,
    fromId,
    setFromId,
    toId,
    setToId,
    picking,
    setPicking,
    following,
    setFollowing,
    setFocusPoint,
    location,
    setLocation,
    notice,
    pendingCar,
    feed,
    sidebar,
    cars,
    feature,
    car,
    selectFeature,
    selectVehicle,
    selectRoute,
    surprise,
    locate,
    toggleSave,
    changeComparison,
    pickStop,
    collectCar,
    importEarlierJournal,
    shownRoutes,
    panelTitle,
  } = workspace;
  if (!data) return null;
  return (
    <aside className="sidebar" aria-label="Stop and route details">
      <button
        className="mobile-panel-toggle"
        aria-expanded={mobilePanelOpen}
        aria-controls="sidebar-content"
        aria-label={mobilePanelOpen ? 'Collapse details' : 'Show details and map tools'}
        onClick={() => setMobilePanelOpen((open) => !open)}
      >
        <span className="panel-handle" aria-hidden="true" />
        <span className="mobile-panel-heading">
          <strong>{panelTitle}</strong>
          <small>
            {mobilePanelOpen
              ? 'Collapse to see more of the map'
              : 'Tap a streetcar or stop, or open map tools'}
          </small>
        </span>
        <span className="panel-chevron" aria-hidden="true">
          {mobilePanelOpen ? '⌄' : '⌃'}
        </span>
      </button>
      <SidebarTabs
        value={panel}
        onChange={(next) => {
          setPanel(next);
          setMobilePanelOpen(true);
          sidebar.current?.scrollTo({ top: 0 });
        }}
      />
      <div ref={sidebar} id="sidebar-content" className="sidebar-content">
        <div className="explore-tools">
          <button className="action-button surprise-button" onClick={surprise}>
            ✦ Surprise me
          </button>
          <ShareMap
            selection={selection}
            filters={filters}
            contextRoute={selectedRoute}
            tools={{ panel, fromId, toId }}
          />
        </div>
        <div className="explore-layers" aria-label="Explore rail layers">
          <button
            className={`layer-toggle ${filters.streetcar ? 'is-on' : ''}`}
            aria-pressed={filters.streetcar}
            onClick={() => setFilters({ ...filters, streetcar: !filters.streetcar })}
          >
            <span aria-hidden="true" /> Streetcar · {filters.streetcar ? 'On' : 'Off'}
          </button>
          <button
            className={`layer-toggle ${filters.subway ? 'is-on' : ''}`}
            aria-pressed={filters.subway}
            onClick={() => setFilters({ ...filters, subway: !filters.subway })}
          >
            <span aria-hidden="true" /> Subway · {filters.subway ? 'On' : 'Off'}
          </button>
        </div>
        {notice && (
          <p role="status" className="tip">
            {notice}
          </p>
        )}
        <div
          id="panel-explore"
          role="tabpanel"
          aria-label="Explore tools"
          hidden={panel !== 'explore'}
        >
          {selection?.kind === 'car' && !car && (
            <p role="status" className="tip">
              {feed.snapshot
                ? `Car ${selection.id} is not in the latest vehicle feed. It may be out of service.`
                : feed.failed
                  ? 'Live positions unavailable. This streetcar will appear when the feed recovers.'
                  : 'Waiting for this streetcar’s live position…'}
            </p>
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
            onJournal={car && car.vehicle.mode !== 'subway' ? collectCar : undefined}
            journalSaved={Boolean(
              car && journal.some((entry) => entry.vehicleId === car.vehicle.id),
            )}
            journalFull={journal.length >= JOURNAL_LIMIT}
            onOpenJournal={() => setPanel('journal')}
            onToggleSave={feature ? toggleSave : undefined}
            following={following}
            onFollow={car ? () => setFollowing((current) => !current) : undefined}
            onCompare={
              feature
                ? (end) => {
                    if (end === 'from') setFromId(feature.id);
                    else setToId(feature.id);
                    setPanel('compare');
                    setPicking(undefined);
                    setFocusPoint(undefined);
                  }
                : undefined
            }
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
          <MyStops
            data={data}
            ids={savedStops}
            persistent={savedPersistent}
            onSelect={selectFeature}
            onRemove={(id) =>
              setSavedStops((current) => current.filter((stop) => stop !== id))
            }
          />
          <NearbyStops
            data={data}
            location={location}
            onLocate={locate}
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
          <RouteLegend
            routes={shownRoutes}
            selectedRoute={selectedRoute}
            onSelect={selectRoute}
          />
        </div>
        <div
          id="panel-fleet"
          role="tabpanel"
          aria-label="Fleet tools"
          hidden={panel !== 'fleet'}
        >
          <FleetExplorer
            data={data}
            cars={cars}
            snapshot={feed.snapshot}
            active={feed.active}
            failed={feed.failed}
            location={location}
            onSelect={(car) => selectVehicle(car, true)}
            onEnableLive={() => setFilters((current) => ({ ...current, live: true }))}
          />
        </div>
        <div
          id="panel-compare"
          role="tabpanel"
          aria-label="Compare tools"
          hidden={panel !== 'compare'}
        >
          <StopComparison
            data={data}
            fromId={fromId}
            toId={toId}
            picking={picking}
            includeOvernight={filters.overnight}
            onChange={changeComparison}
            onPick={pickStop}
            onOvernight={(overnight) => {
              setFilters((current) => ({ ...current, overnight }));
              if (
                !overnight &&
                data.routes.find((route) => route.id === selectedRoute)?.overnight
              ) {
                setSelectedRoute(undefined);
                if (selection?.kind === 'route') setSelection(undefined);
              }
            }}
            onRoute={selectRoute}
          />
        </div>
        <div
          id="panel-stops"
          role="tabpanel"
          aria-label="Stop directory"
          hidden={panel !== 'stops'}
        >
          <StopBrowser
            data={data}
            savedIds={savedStops}
            location={location}
            onSelect={selectFeature}
          />
        </div>
        <div
          id="panel-journal"
          role="tabpanel"
          aria-label="Streetcar journal"
          hidden={panel !== 'journal'}
        >
          <AccountRequired>
            {accountJournal.error && (
              <div className="tip" role="alert">
                {accountJournal.error}{' '}
                <button className="action-button" onClick={accountJournal.reload}>
                  Reload journal
                </button>
              </div>
            )}
            <p className="microcopy" role="status">
              {accountJournal.saving
                ? 'Saving your journal…'
                : accountJournal.ready
                  ? 'Your journal is saved to your account.'
                  : 'Loading your journal…'}
            </p>
            <fieldset className="journal-fieldset" disabled={!accountJournal.ready}>
              <StreetcarJournal
                entries={journal}
                persistent
                accountSaved
                cars={cars}
                active={feed.active}
                loaded={Boolean(feed.snapshot)}
                failed={feed.failed}
                onChange={setJournal}
                onSelect={(car) => selectVehicle(car, true)}
                onFleet={() => setPanel('fleet')}
              />
              <button className="action-button" onClick={importEarlierJournal}>
                Import earlier browser journal
              </button>
              <p className="microcopy">
                Only import on your own device. This copies the earlier browser collection
                into the account you are signed in to.
              </p>
            </fieldset>
            <a className="account-link" href="/profile">
              Profile and badge privacy settings →
            </a>
          </AccountRequired>
        </div>
        <PageFooter />
      </div>
    </aside>
  );
}
