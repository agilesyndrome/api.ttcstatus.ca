import { useEffect, useMemo, useRef, useState } from 'react';
import { buildViewerData, type Feature, type ViewerData, type ViewerSource } from '../../map/model';
import { projectSnapshot, type PlottedVehicle } from '../../map/live-status';
import { useVehicleFeed } from '../hooks/useVehicleFeed';
import { PageHeader } from '../components/PageHeader';
import { PageFooter } from '../components/PageFooter';
import { MapFilters, type MapFilterValues } from '../components/MapFilters';
import { RouteLegend } from '../components/RouteLegend';
import { LiveFeedStatus } from '../components/LiveFeedStatus';
import { TransitMap } from '../components/TransitMap';
import { StopDetails } from '../components/StopDetails';

export function HomePage() {
  const [data, setData] = useState<ViewerData>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<MapFilterValues>({ live: true, labels: false, overnight: false });
  const [selectedRoute, setSelectedRoute] = useState<string>();
  const [feature, setFeature] = useState<Feature>();
  const [vehicleId, setVehicleId] = useState<string>();
  const [resetKey, setResetKey] = useState(0);
  const feed = useVehicleFeed(filters.live && Boolean(data));
  const previous = useRef<PlottedVehicle[]>([]);
  const cars = useMemo(() => data && feed.snapshot ? projectSnapshot(data, feed.snapshot, feed.now, previous.current) : [], [data, feed.snapshot, feed.now]);
  useEffect(() => { previous.current = cars; }, [cars]);
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
  function reset() { setFeature(undefined); setVehicleId(undefined); setSelectedRoute(undefined); setResetKey(key => key + 1); }
  function selectFeature(next: Feature) { setFeature(next); setVehicleId(undefined); if (selectedRoute && !next.routeIds.includes(selectedRoute)) setSelectedRoute(undefined); }
  return <><PageHeader data={data} onSelect={selectFeature} onReset={reset} />
    {data ? <main className="workspace"><TransitMap data={data} cars={filters.live ? cars : []} selectedRoute={selectedRoute} selectedFeature={feature} showLabels={filters.labels} includeOvernight={filters.overnight} resetKey={resetKey} onSelectFeature={selectFeature} onSelectVehicle={car => { setVehicleId(car.vehicle.id); setFeature(undefined); }} />
      <aside className="sidebar" aria-label="Stop and route details"><MapFilters value={filters} onChange={next => { setFilters(next); if (!next.live) setVehicleId(undefined); if (!next.overnight && data.routes.find(route => route.id === selectedRoute)?.overnight) setSelectedRoute(undefined); }} /><LiveFeedStatus {...feed} /><StopDetails data={data} feature={feature} car={cars.find(car => car.vehicle.id === vehicleId)} onClose={() => { setFeature(undefined); setVehicleId(undefined); }} /><RouteLegend routes={data.routes.filter(route => filters.overnight || !route.overnight)} selectedRoute={selectedRoute} onSelect={id => { setSelectedRoute(id); setFeature(undefined); setVehicleId(undefined); }} /><PageFooter /></aside>
    </main> : <main className="loading-page"><h1>TTC status map</h1><p role={error ? 'alert' : 'status'}>{error ?? 'Loading the streetcar network…'}</p>{error && <button onClick={() => setAttempt(value => value + 1)}>Try again</button>}<PageFooter /></main>}
  </>;
}
