import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { boundsOf, buildViewerData, type Feature, type ViewerData, type ViewerSource, type Point } from '../../map/model';
import { gpsToMap } from '../../../workers/shared/map-projection';
import { projectSnapshot, type PlottedVehicle } from '../../map/live-status';
import { useVehicleFeed } from '../hooks/useVehicleFeed';
import { usePreference } from '../hooks/usePreferences';
import { useTheme } from '../hooks/useTheme';
import { useShortcuts } from '../hooks/useShortcuts';
import { DEFAULT_FILTERS, mapLinkHash, nearbyStops, readMapLink, validFilters, validSavedStops, type Location, type Selection, type SidebarPanel } from '../commute';
import { PageHeader } from '../components/PageHeader';
import { PageFooter } from '../components/PageFooter';
import { MapFilters } from '../components/MapFilters';
import { RouteLegend } from '../components/RouteLegend';
import { LiveFeedStatus } from '../components/LiveFeedStatus';
import { TransitMap } from '../components/TransitMap';
import { StopDetails } from '../components/StopDetails';
import { MyStops } from '../components/MyStops';
import { NearbyStops } from '../components/NearbyStops';
import { RoutePulse } from '../components/RoutePulse';
import { ShareMap } from '../components/ShareMap';
import { FleetExplorer } from '../components/FleetExplorer';
import { StopComparison, type PickingStop } from '../components/StopComparison';
import { SidebarTabs } from '../components/SidebarTabs';
import { KeyboardHelp } from '../components/KeyboardHelp';

import { StopBrowser } from '../components/StopBrowser';
import { StreetcarJournal } from '../components/StreetcarJournal';
import { JOURNAL_LIMIT, journalEntry, mergeJournal, validJournal } from '../journal';
import { exportMap } from '../map-export';
import { MapExport } from '../components/MapExport';
import { AccountRequired, AuthControls, useAccount } from '../auth';
import { useAccountJournal } from '../hooks/useAccountJournal';

const SnakeGame = lazy(() => import('../components/SnakeGame').then(module => ({ default: module.SnakeGame })));

const validBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

export function HomePage() {
  const [data, setData] = useState<ViewerData>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = usePreference('ttc:filters:v1', DEFAULT_FILTERS, validFilters);
  const [savedStops, setSavedStops, savedPersistent] = usePreference<string[]>('ttc:stops:v1', [], validSavedStops);
  const account = useAccount();
  const accountJournal = useAccountJournal();
  const journal = accountJournal.entries;
  const setJournal = accountJournal.change;
  const [exportImage, setExportImage] = useState<string>();
  const [exportCars, setExportCars] = useState(true);
  const capturedMap = useRef<SVGSVGElement | undefined>(undefined);
  const exportDetails = useRef<Parameters<typeof exportMap>[1] | undefined>(undefined);
  const [initialLink] = useState(() => readMapLink(window.location.hash));
  const [selection, setSelection] = useState<Selection | undefined>(initialLink.selection);
  const [selectedRoute, setSelectedRoute] = useState<string | undefined>(() => {
    const link = initialLink;
    return link.selection?.kind === 'route' ? link.selection.id : link.contextRoute;
  });
  const [panel, setPanel] = useState<SidebarPanel>(initialLink.panel ?? 'explore');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(Boolean(initialLink.selection || initialLink.panel && initialLink.panel !== 'explore'));
  const [fromId, setFromId] = useState(initialLink.fromId);
  const [toId, setToId] = useState(initialLink.toId);
  const [picking, setPicking] = useState<PickingStop>();
  const [following, setFollowing] = useState(false);
  const [snakeOpen, setSnakeOpen] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = usePreference('ttc:shortcuts:v1', true, validBoolean);
  const [focusPoint, setFocusPoint] = useState<Point>();
  const [location, setLocation] = useState<Location>();
  const [notice, setNotice] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const theme = useTheme();
  const pendingCar = useRef(selection?.kind === 'car' ? selection.id : undefined);
  const feed = useVehicleFeed((filters.live || snakeOpen) && Boolean(data));
  const previous = useRef<PlottedVehicle[]>([]);
  const sidebar = useRef<HTMLDivElement>(null);
  const cars = useMemo(() => data && feed.snapshot ? projectSnapshot(data, feed.snapshot, feed.now, previous.current) : [], [data, feed.snapshot, feed.now]);
  const feature = useMemo(() => {
    const stop = selection?.kind === 'stop' ? data?.features.find(feature => feature.id === selection.id) : undefined;
    return stop ? { ...stop } : undefined; // Reselecting a bookmark focuses it again, without moving on feed refreshes.
  }, [selection, data]);
  const car = selection?.kind === 'car' ? cars.find(car => car.vehicle.id === selection.id) : undefined;
  const locationPoint = useMemo(() => data && location ? gpsToMap(location.latitude, location.longitude, data.geographicTransform) : undefined, [data, location]);
  const comparisonStops = useMemo(() => ({ from: data?.features.find(stop => stop.id === fromId), to: data?.features.find(stop => stop.id === toId) }), [data, fromId, toId]);
  const comparisonBounds = useMemo(() => panel === 'compare' && comparisonStops.from && comparisonStops.to
    ? boundsOf([comparisonStops.from.point, comparisonStops.to.point], 70) : undefined, [panel, comparisonStops]);
  useEffect(() => { previous.current = cars; }, [cars]);
  useEffect(() => {
    if (panel === 'explore' && selection) {
      setMobilePanelOpen(true);
      sidebar.current?.scrollTo({ top: 0 });
    }
  }, [selection, panel]);
  useEffect(() => {
    if (panel !== 'explore') setMobilePanelOpen(true);
    sidebar.current?.scrollTo({ top: 0 });
    if (panel !== 'compare') setPicking(undefined);
    if (panel !== 'explore') { setFollowing(false); pendingCar.current = undefined; }
  }, [panel]);

  useEffect(() => {
    const restore = () => {
      const link = readMapLink(window.location.hash);
      setSelection(link.selection); setNotice(''); setFocusPoint(undefined);
      setSelectedRoute(link.selection?.kind === 'route' ? link.selection.id : link.contextRoute);
      setPanel(link.panel ?? 'explore'); setFromId(link.fromId); setToId(link.toId); setPicking(undefined); setFollowing(false);
      pendingCar.current = link.selection?.kind === 'car' ? link.selection.id : undefined;
      setFilters({ ...DEFAULT_FILTERS, ...link.filters, ...(link.selection?.kind === 'car' ? { live: true } : {}) });
    };
    // A shared link takes precedence over local layer preferences.
    if (window.location.hash) restore();
    window.addEventListener('hashchange', restore);
    return () => window.removeEventListener('hashchange', restore);
  }, []);
  useEffect(() => {
    if (!data) return;
    const url = new URL(window.location.href);
    url.hash = mapLinkHash(selection, filters, selectedRoute, { panel, fromId, toId });
    window.history.replaceState(null, '', url);
  }, [data, selection, filters, selectedRoute, panel, fromId, toId]);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    async function load() {
      try {
        const response = await fetch('/api/v1/map/streetcar?format=schematic-v1', { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error(response.status === 503 ? 'The streetcar map is being prepared. Please try again shortly.' : `Map request failed (${response.status}).`);
        setData(buildViewerData(await response.json() as ViewerSource));
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load the streetcar map.'); }
    }
    void load(); return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!data || !selection) return;
    if ((selection.kind === 'stop' && !feature) || (selection.kind === 'route' && !data.routes.some(route => route.id === selection.id && route.scheduled))) {
      setNotice('That shared stop or route is no longer in this map. Choose another below.');
      setSelection(undefined); setSelectedRoute(undefined);
    } else if (selection.kind === 'route' && data.routes.find(route => route.id === selection.id)?.overnight) {
      setFilters(current => current.overnight ? current : { ...current, overnight: true });
    } else if (feature?.routeIds.length && feature.routeIds.every(id => data.routes.find(route => route.id === id)?.overnight)) {
      setFilters(current => current.overnight ? current : { ...current, overnight: true });
    }
  }, [data, selection, feature, setFilters]);
  useEffect(() => {
    if (!data || !selectedRoute) return;
    const route = data.routes.find(route => route.id === selectedRoute && route.scheduled);
    if (!route) setSelectedRoute(undefined);
    else if (feature && !feature.routeIds.includes(selectedRoute)) setSelectedRoute(undefined);
    else if (route.overnight) setFilters(current => current.overnight ? current : { ...current, overnight: true });
  }, [data, selectedRoute, feature, setFilters]);
  useEffect(() => {
    if (!car || pendingCar.current !== car.vehicle.id) return;
    pendingCar.current = undefined;
    if (selectedRoute && selectedRoute !== car.vehicle.routeId) setSelectedRoute(undefined);
    setFilters(current => ({ ...current, live: true, overnight: current.overnight || Boolean(data?.routes.find(route => route.id === car.vehicle.routeId)?.overnight) }));
    setFocusPoint([...car.point]);
  }, [car, data, selectedRoute, setFilters]);
  useEffect(() => {
    if (!data) return;
    if (fromId && !data.features.some(stop => stop.id === fromId && stop.boardingPoints > 0)) { setFromId(undefined); setNotice('A shared comparison stop is no longer available. Choose a current boarding stop.'); }
    if (toId && !data.features.some(stop => stop.id === toId && stop.boardingPoints > 0)) { setToId(undefined); setNotice('A shared comparison stop is no longer available. Choose a current boarding stop.'); }
  }, [data, fromId, toId]);
  useEffect(() => {
    if (following && car && !car.stale) setFocusPoint([...car.point]);
  }, [following, car?.vehicle.id, car?.point[0], car?.point[1], car?.stale]);

  function reset() {
    setMobilePanelOpen(false);
    pendingCar.current = undefined; setSelection(undefined); setSelectedRoute(undefined); setNotice(''); setFocusPoint(undefined);
    setPanel('explore'); setFromId(undefined); setToId(undefined); setPicking(undefined); setFollowing(false); setResetKey(key => key + 1);
  }
  function selectFeature(next: Feature) {
    setMobilePanelOpen(true);
    pendingCar.current = undefined; setFocusPoint(undefined); setNotice(''); setFollowing(false);
    if (panel === 'compare' && picking) {
      if (!next.boardingPoints) { setNotice('Choose a boarding stop for this comparison.'); return; }
      picking === 'from' ? setFromId(next.id) : setToId(next.id);
      setPicking(undefined); return;
    }
    setPanel('explore');
    setSelection({ kind: 'stop', id: next.id });
    if (selectedRoute && !next.routeIds.includes(selectedRoute)) setSelectedRoute(undefined);
  }
  function selectVehicle(next: PlottedVehicle, focus = false) {
    setMobilePanelOpen(true);
    pendingCar.current = undefined; setSelection({ kind: 'car', id: next.vehicle.id }); setNotice(''); setPanel('explore'); setFollowing(false);
    if (focus) {
      setSelectedRoute(undefined);
      setFilters(current => ({ ...current, live: true, overnight: current.overnight || Boolean(data?.routes.find(route => route.id === next.vehicle.routeId)?.overnight) }));
      setFocusPoint([...next.point]);
    }
  }
  function selectRoute(id?: string) { pendingCar.current = undefined; setSelectedRoute(id); setSelection(id ? { kind: 'route', id } : undefined); setFocusPoint(undefined); setNotice(''); setFollowing(false); }
  function surprise() {
    if (!data) return;
    const stops = data.features.filter(stop => stop.id !== feature?.id && stop.boardingPoints > 0 && stop.routeIds.some(id => data.routes.some(route => route.id === id && (filters.overnight || !route.overnight))));
    if (stops.length) selectFeature(stops[Math.floor(Math.random() * stops.length)]);
  }
  function locate(next: Location) {
    if (!data) return;
    setLocation(next); setFollowing(false);
    if (nearbyStops(data, next).length) setFocusPoint(gpsToMap(next.latitude, next.longitude, data.geographicTransform));
    else { setFocusPoint(undefined); setResetKey(key => key + 1); }
  }
  function toggleSave() {
    if (!feature) return;
    if (!savedStops.includes(feature.id) && savedStops.length >= 100) { setNotice('Your 100 saved stops are full. Remove a stop to save another.'); return; }
    setSavedStops(current => current.includes(feature.id) ? current.filter(id => id !== feature.id) : current.length < 100 ? [...current, feature.id] : current);
  }
  function changeComparison(from?: string, to?: string) {
    setFromId(from); setToId(to); setPicking(undefined); setFocusPoint(undefined); setSelectedRoute(undefined); setNotice('');
    if (selection?.kind === 'route') setSelection(undefined);
  }
  function pickStop(end?: PickingStop) {
    if (end) setMobilePanelOpen(false);
    setPicking(end); setSelectedRoute(undefined); setNotice('');
    if (selection?.kind === 'route') setSelection(undefined);
  }
  function collectCar() {
    if (!account.userId) { setPanel('journal'); setMobilePanelOpen(true); return; }
    if (!accountJournal.ready) { setNotice('Wait for your journal to load or finish saving, then try again.'); return; }
    if (!car || journal.length >= JOURNAL_LIMIT || journal.some(entry => entry.vehicleId === car.vehicle.id)) return;
    const entry = journalEntry(car, data?.routes ?? []);
    if (!validJournal([entry])) { setNotice('This car’s supplied identifier cannot be saved in the journal.'); return; }
    setJournal(current => current.some(item => item.vehicleId === entry.vehicleId) || current.length >= JOURNAL_LIMIT ? current : [...current, entry]);
    setNotice('Car ' + car.vehicle.label + ' added to your journal.');
  }
  function importEarlierJournal() {
    try {
      const earlier: unknown = JSON.parse(localStorage.getItem('ttc:journal:v1') ?? 'null');
      if (!validJournal(earlier)) { setNotice('No valid earlier journal was found in this browser. You can restore a backup instead.'); return; }
      const merged = mergeJournal(journal, earlier);
      setJournal(() => merged.entries);
      setNotice(`${merged.added} earlier cars added. Existing notes were kept.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to import this browser’s earlier journal.'); }
  }
  function previewMap() {
    const svg = document.querySelector<SVGSVGElement>('#map');
    if (!svg || !data) return;
    capturedMap.current = svg.cloneNode(true) as SVGSVGElement;
    // Preserve the original viewport ratio in the detached frozen copy.
    const box = svg.getBoundingClientRect();
    capturedMap.current.getBoundingClientRect = () => box;
    exportDetails.current = {
      title: 'Toronto streetcar map', snapshot: data.snapshot, capturedAt: new Date().toISOString(), northAngle: data.northAngle,
      routes: shownRoutes.filter(route => route.scheduled), includeCars: exportCars,
      feed: feed.snapshot ? 'Vehicle snapshot: ' + feed.snapshot.fetchedAt + ' · ' + feed.snapshot.attribution + (feed.failed ? ' · Last refresh unavailable' : !feed.active ? ' · Live feed paused' : '') : 'No vehicle snapshot loaded.',
      endpoints: panel === 'compare' ? [comparisonStops.from ? 'A: ' + comparisonStops.from.name : '', comparisonStops.to ? 'B: ' + comparisonStops.to.name : ''].filter(Boolean) : [],
    };
    setExportImage(exportMap(capturedMap.current, exportDetails.current));
  }
  function changeExportCars(includeCars: boolean) {
    setExportCars(includeCars);
    if (capturedMap.current && exportDetails.current) setExportImage(exportMap(capturedMap.current, { ...exportDetails.current, includeCars }));
  }
  useShortcuts(shortcutsEnabled && !snakeOpen, {
    '/': () => document.querySelector<HTMLInputElement>('.search input')?.focus(),
    e: () => setPanel('explore'), f: () => setPanel('fleet'), c: () => setPanel('compare'),
    d: () => setPanel('stops'), j: () => setPanel('journal'), p: previewMap,
    s: toggleSave, n: theme.toggle, r: reset, '?': () => setShortcutHelp(true),
  });
  const headerActions = <div className="header-actions"><button className="shortcut-toggle" aria-label="Keyboard shortcuts" onClick={() => setShortcutHelp(true)}>?</button><button className="theme-toggle" aria-label={theme.dark ? 'Switch to day theme' : 'Switch to night theme'} onClick={theme.toggle}>{theme.dark ? '☀ Day' : '☾ Night'}</button><AuthControls /></div>;
  const shownRoutes = data?.routes.filter(route => filters.overnight || !route.overnight) ?? [];
  const panelTitle = panel === 'explore'
    ? car ? `Car ${car.vehicle.label}` : feature?.name ?? (selection?.kind === 'car' ? `Car ${selection.id}` : 'Explore streetcars')
    : { fleet: 'Streetcar fleet', compare: 'Compare stops', stops: 'Stop directory', journal: 'Streetcar journal' }[panel];
  return <>{snakeOpen && data && <Suspense fallback={<div className="snake-loading" role="status">Loading Streetcar Snake…</div>}><SnakeGame data={data} cars={cars} feed={feed} onClose={() => { setSnakeOpen(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.snake-launch')?.focus()); }} /></Suspense>}<PageHeader data={data} cars={cars} onSelect={selectFeature} onSelectVehicle={car => selectVehicle(car, true)} onReset={reset} actions={headerActions} />
    {data ? <main className={`workspace${mobilePanelOpen ? ' mobile-panel-open' : ''}`}><TransitMap mapTools={<button className="snake-launch" aria-label="Play Streetcar Snake" title="Play Streetcar Snake" onClick={() => setSnakeOpen(true)}>🐍</button>} data={data} cars={filters.live ? cars : []} selectedRoute={selectedRoute} selectedFeature={feature} selectedVehicleId={car?.vehicle.id} focusPoint={focusPoint} focusBounds={comparisonBounds} locationPoint={locationPoint} comparisonStops={panel === 'compare' ? comparisonStops : undefined} pickingLabel={picking ? `Choose a ${picking === 'from' ? 'start' : 'destination'} boarding stop` : undefined} onInteract={() => setFollowing(false)} onExport={previewMap} savedStopIds={savedStops} showLabels={filters.labels} includeOvernight={filters.overnight} resetKey={resetKey} onSelectFeature={selectFeature} onSelectVehicle={car => selectVehicle(car)} />
      <aside className="sidebar" aria-label="Stop and route details">
        <button className="mobile-panel-toggle" aria-expanded={mobilePanelOpen} aria-controls="sidebar-content" aria-label={mobilePanelOpen ? 'Collapse details' : 'Show details and map tools'} onClick={() => setMobilePanelOpen(open => !open)}>
          <span className="panel-handle" aria-hidden="true" />
          <span className="mobile-panel-heading"><strong>{panelTitle}</strong><small>{mobilePanelOpen ? 'Collapse to see more of the map' : 'Tap a streetcar or stop, or open map tools'}</small></span>
          <span className="panel-chevron" aria-hidden="true">{mobilePanelOpen ? '⌄' : '⌃'}</span>
        </button>
        <SidebarTabs value={panel} onChange={next => { setPanel(next); setMobilePanelOpen(true); sidebar.current?.scrollTo({ top: 0 }); }} />
        <div ref={sidebar} id="sidebar-content" className="sidebar-content">
        <div className="explore-tools"><button className="action-button surprise-button" onClick={surprise}>✦ Surprise me</button><ShareMap selection={selection} filters={filters} contextRoute={selectedRoute} tools={{ panel, fromId, toId }} /></div>
        {notice && <p role="status" className="tip">{notice}</p>}
        <div id="panel-explore" role="tabpanel" aria-label="Explore tools" hidden={panel !== 'explore'}>
        {selection?.kind === 'car' && !car && <p role="status" className="tip">{feed.snapshot ? `Car ${selection.id} is not in the latest vehicle feed. It may be out of service.` : feed.failed ? 'Live positions unavailable. This streetcar will appear when the feed recovers.' : 'Waiting for this streetcar’s live position…'}</p>}
        <StopDetails data={data} feature={feature} car={car} cars={cars} saved={Boolean(feature && savedStops.includes(feature.id))} saveLimit={savedStops.length >= 100} liveEnabled={filters.live} feedLoaded={Boolean(feed.snapshot)} feedFailed={feed.failed}
          onJournal={car ? collectCar : undefined} journalSaved={Boolean(car && journal.some(entry => entry.vehicleId === car.vehicle.id))} journalFull={journal.length >= JOURNAL_LIMIT} onOpenJournal={() => setPanel('journal')}
          onToggleSave={feature ? toggleSave : undefined} following={following} onFollow={car ? () => setFollowing(current => !current) : undefined}
          onCompare={feature ? end => { end === 'from' ? setFromId(feature.id) : setToId(feature.id); setPanel('compare'); setPicking(undefined); setFocusPoint(undefined); } : undefined}
          onSelectVehicle={car => selectVehicle(car, true)} onClose={() => { pendingCar.current = undefined; setSelection(undefined); setFocusPoint(undefined); setFollowing(false); setMobilePanelOpen(false); if (window.matchMedia('(max-width: 640px)').matches) document.getElementById('map')?.focus(); }} />
        <MyStops data={data} ids={savedStops} persistent={savedPersistent} onSelect={selectFeature} onRemove={id => setSavedStops(current => current.filter(stop => stop !== id))} />
        <NearbyStops data={data} location={location} onLocate={locate} onClear={() => { setLocation(undefined); setFocusPoint(undefined); }} onSelect={selectFeature} />
        <MapFilters value={filters} onChange={next => {
          setFilters(next);
          if (!next.live && selection?.kind === 'car') { pendingCar.current = undefined; setSelection(selectedRoute ? { kind: 'route', id: selectedRoute } : undefined); }
          if (!next.overnight && data.routes.find(route => route.id === selectedRoute)?.overnight) { setSelectedRoute(undefined); if (selection?.kind === 'route') setSelection(undefined); }
        }} />
        <LiveFeedStatus {...feed} />
        <RoutePulse routes={shownRoutes} cars={cars} loaded={Boolean(feed.snapshot)} active={feed.active} failed={feed.failed} selectedRoute={selectedRoute} onSelect={id => selectRoute(selectedRoute === id ? undefined : id)} />
        <RouteLegend routes={shownRoutes} selectedRoute={selectedRoute} onSelect={selectRoute} />
        </div>
        <div id="panel-fleet" role="tabpanel" aria-label="Fleet tools" hidden={panel !== 'fleet'}>
          <FleetExplorer data={data} cars={cars} snapshot={feed.snapshot} active={feed.active} failed={feed.failed} location={location} onSelect={car => selectVehicle(car, true)} onEnableLive={() => setFilters(current => ({ ...current, live: true }))} />
        </div>
        <div id="panel-compare" role="tabpanel" aria-label="Compare tools" hidden={panel !== 'compare'}>
          <StopComparison data={data} fromId={fromId} toId={toId} picking={picking} includeOvernight={filters.overnight} onChange={changeComparison} onPick={pickStop} onOvernight={overnight => {
            setFilters(current => ({ ...current, overnight }));
            if (!overnight && data.routes.find(route => route.id === selectedRoute)?.overnight) { setSelectedRoute(undefined); if (selection?.kind === 'route') setSelection(undefined); }
          }} onRoute={selectRoute} />
        </div>
        <div id="panel-stops" role="tabpanel" aria-label="Stop directory" hidden={panel !== 'stops'}>
          <StopBrowser data={data} savedIds={savedStops} location={location} onSelect={selectFeature} />
        </div>
        <div id="panel-journal" role="tabpanel" aria-label="Streetcar journal" hidden={panel !== 'journal'}>
          <AccountRequired>
            {accountJournal.error && <div className="tip" role="alert">{accountJournal.error} <button className="action-button" onClick={accountJournal.reload}>Reload journal</button></div>}
            <p className="microcopy" role="status">{accountJournal.saving ? 'Saving your journal…' : accountJournal.ready ? 'Your journal is saved to your account.' : 'Loading your journal…'}</p>
            <fieldset className="journal-fieldset" disabled={!accountJournal.ready}><StreetcarJournal entries={journal} persistent accountSaved cars={cars} active={feed.active} loaded={Boolean(feed.snapshot)} failed={feed.failed} onChange={setJournal} onSelect={car => selectVehicle(car, true)} onFleet={() => setPanel('fleet')} /><button className="action-button" onClick={importEarlierJournal}>Import earlier browser journal</button><p className="microcopy">Only import on your own device. This copies the earlier browser collection into the account you are signed in to.</p></fieldset>
            <a className="account-link" href="/profile">Profile and badge privacy settings →</a>
          </AccountRequired>
        </div>
        <PageFooter />
        </div>
      </aside>
    </main> : <main className="loading-page"><h1>TTC status map</h1><p role={error ? 'alert' : 'status'}>{error ?? 'Loading the streetcar network…'}</p>{error && <button onClick={() => setAttempt(value => value + 1)}>Try again</button>}<PageFooter /></main>}
    <MapExport image={exportImage} includeCars={exportCars} onCars={changeExportCars} onClose={() => { setExportImage(undefined); capturedMap.current = undefined; exportDetails.current = undefined; }} />
    <KeyboardHelp open={shortcutHelp} enabled={shortcutsEnabled} onEnabled={setShortcutsEnabled} onClose={() => setShortcutHelp(false)} />
  </>;
}
