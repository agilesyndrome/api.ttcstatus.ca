import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { PageFooter } from '../../components/PageFooter';
import { MapFilters } from '../map/MapFilters';
import { RouteLegend } from '../map/RouteLegend';
import { RouteGuide } from './RouteGuide';
import { LiveFeedStatus } from '../map/LiveFeedStatus';

import { StopDetails } from '../stops/StopDetails';
import { MyStops } from '../stops/MyStops';
import { NearbyStops } from '../stops/NearbyStops';
import { RoutePulse } from '../map/RoutePulse';
import { ShareMap } from '../export/ShareMap';
import { FleetExplorer } from '../fleet/FleetExplorer';
import { StopComparison } from '../comparison/StopComparison';
import { SavedComparisons } from '../comparison/SavedComparisons';
import { SidebarTabs } from '../../components/SidebarTabs';

import { StopBrowser } from '../stops/StopBrowser';
import { StreetcarJournal } from '../journal/StreetcarJournal';
import { JOURNAL_LIMIT } from '../../../../shared/accounts/journal';

import { AccountRequired } from '../accounts/auth';

import type { HomeWorkspaceState } from './useHomeWorkspace';

export function HomeSidebar({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
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
  const guideRoute = data.routes.find((route) => route.id === selectedRoute);
  return (
    <aside className="sidebar" aria-label={t('workspace.stopAndRouteDetails')}>
      <button
        className="mobile-panel-toggle"
        aria-expanded={mobilePanelOpen}
        aria-controls="sidebar-content"
        aria-label={
          mobilePanelOpen
            ? t('workspace.collapseDetails')
            : t('workspace.showDetailsAndMapTools')
        }
        onClick={() => setMobilePanelOpen((open) => !open)}
      >
        <span className="panel-handle" aria-hidden="true" />
        <span className="mobile-panel-heading">
          <strong>{panelTitle}</strong>
          <small>
            {mobilePanelOpen
              ? t('workspace.collapseToSeeMoreOfTheMap')
              : t('workspace.tapAStreetcarOrStopOrOpenMapTools')}
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
            {t('workspace.surpriseMe')}
          </button>
          <ShareMap
            selection={selection}
            filters={filters}
            contextRoute={selectedRoute}
            tools={{ panel, fromId, toId }}
          />
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
        {notice && (
          <p role="status" className="tip">
            {t(notice)}
          </p>
        )}
        <div
          id="panel-explore"
          role="tabpanel"
          aria-label={t('workspace.exploreTools')}
          hidden={panel !== 'explore'}
        >
          {selection?.kind === 'car' && !car && (
            <p role="status" className="tip">
              {feed.snapshot
                ? t('workspace.carValueIsNotInTheLatestVehicleFeedIt', {
                    value1: selection.id,
                  })
                : feed.failed
                  ? t(
                      'workspace.livePositionsUnavailableThisStreetcarWillAppearWhenTheFeed',
                    )
                  : t('workspace.waitingForThisStreetcarSLivePosition')}
            </p>
          )}
          {guideRoute && (
            <div hidden={selection?.kind !== 'route'}>
              <RouteGuide
                key={guideRoute.id}
                data={data}
                route={guideRoute}
                savedIds={savedStops}
                onSelect={selectFeature}
                onClose={() => selectRoute(undefined)}
                onCompare={(from, to) => {
                  changeComparison(from, to);
                  setPanel('compare');
                }}
              />
            </div>
          )}
          {(!guideRoute || selection?.kind !== 'route') && (
            <>
              {guideRoute && feature && (
                <button
                  className="text-button back-to-route"
                  onClick={() => selectRoute(guideRoute.id)}
                >
                  {t('workspace.backToValueStops', { route: guideRoute.number })}
                </button>
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
                snapshot={feed.snapshot}
                now={feed.now}
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
            </>
          )}
          <MyStops
            data={data}
            ids={savedStops}
            persistent={savedPersistent}
            onSelect={selectFeature}
            snapshot={feed.snapshot}
            cars={cars}
            now={feed.now}
            enabled={filters.live}
            active={feed.active}
            failed={feed.failed}
            onRestore={setSavedStops}
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
          aria-label={t('workspace.fleetTools')}
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
          aria-label={t('workspace.compareTools')}
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
          <SavedComparisons
            data={data}
            fromId={fromId}
            toId={toId}
            overnight={filters.overnight}
            onChoose={(entry) => {
              changeComparison(entry.fromId, entry.toId);
              setFilters((current) => ({ ...current, overnight: entry.overnight }));
              sidebar.current?.scrollTo({ top: 0 });
            }}
          />
        </div>
        <div
          id="panel-stops"
          role="tabpanel"
          aria-label={t('workspace.stopDirectory')}
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
          aria-label={t('workspace.streetcarJournal')}
          hidden={panel !== 'journal'}
        >
          <AccountRequired>
            {accountJournal.error && (
              <div className="tip" role="alert">
                {t(accountJournal.error)}{' '}
                <button className="action-button" onClick={accountJournal.reload}>
                  {t('workspace.reloadJournal')}
                </button>
              </div>
            )}
            <p className="microcopy" role="status">
              {accountJournal.saving
                ? t('workspace.savingYourJournal')
                : accountJournal.error
                  ? t('workspace.yourLastChangeHasNotBeenSaved')
                  : accountJournal.ready
                    ? t('workspace.yourJournalIsSavedToYourAccount')
                    : t('workspace.loadingYourJournal')}
            </p>
            <fieldset className="journal-fieldset" disabled={!accountJournal.ready}>
              <StreetcarJournal
                key={accountJournal.userId}
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
                {t('workspace.importEarlierBrowserJournal')}
              </button>
              <p className="microcopy">
                {t('workspace.onlyImportOnYourOwnDeviceThisCopiesTheEarlier')}
              </p>
            </fieldset>
            <a className="account-link" href="/profile">
              {t('workspace.profileAndBadgePrivacySettings')}
            </a>
          </AccountRequired>
        </div>
        <PageFooter />
      </div>
    </aside>
  );
}
