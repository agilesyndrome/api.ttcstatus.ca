import { useId, useMemo, useState } from 'react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { ViewerData } from '../../../../shared/map/model';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { formatDistance, type Location } from '../../commute';
import { DEFAULT_FLEET_FILTERS, filterFleet, fleetCsv, type FleetFilters } from './fleet';

interface Props {
  data: ViewerData;
  cars: PlottedVehicle[];
  snapshot?: VehicleSnapshot;
  active: boolean;
  failed: boolean;
  location?: Location;
  onSelect(car: PlottedVehicle): void;
  onEnableLive(): void;
}
const PAGE_SIZE = 20;
export function FleetExplorer({
  data,
  cars,
  snapshot,
  active,
  failed,
  location,
  onSelect,
  onEnableLive,
}: Props) {
  const id = useId();
  const [filters, setFilters] = useState<FleetFilters>(DEFAULT_FLEET_FILTERS);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const sort = filters.sort === 'distance' && !location ? 'number' : filters.sort;
  const results = useMemo(
    () => filterFleet(cars, data.routes, { ...filters, sort }, location),
    [cars, data.routes, filters, sort, location],
  );
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const assignments = [
    ...new Set(cars.flatMap((car) => (car.vehicle.routeId ? [car.vehicle.routeId] : []))),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  function update(next: Partial<FleetFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
    setMessage('');
  }
  function download() {
    if (!snapshot) return;
    const csv = fleetCsv(
      results.map((result) => result.car),
      data.routes,
      snapshot,
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'toronto-streetcar-snapshot.csv';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Downloaded ${results.length} vehicle reports.`);
  }
  return (
    <section className="fleet-explorer" aria-label="Fleet explorer">
      <p className="eyebrow">Meet the fleet</p>
      <h1>Train & streetcar spotting</h1>
      <p className="helper">
        Every car in the shared live snapshot, including overnight assignments. Choose a
        car to see it on the map.
      </p>
      {!active && (
        <>
          <p className="tip">
            Updates are paused.{' '}
            {snapshot
              ? 'Showing the last snapshot.'
              : 'Enable live streetcars to load the fleet.'}
          </p>
          <button className="action-button" onClick={onEnableLive}>
            Enable live updates
          </button>
        </>
      )}
      {failed && (
        <p role="status" className="helper">
          {snapshot
            ? 'Refresh unavailable; keeping the last snapshot.'
            : 'Live vehicle positions are unavailable. The feed will retry.'}
        </p>
      )}
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={`${id}-query`}>Find in fleet</label>
          <input
            id={`${id}-query`}
            type="search"
            value={filters.query}
            placeholder="Car number or route name"
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>
        <div className="form-control">
          <label htmlFor={`${id}-route`}>Route assignment</label>
          <select
            id={`${id}-route`}
            value={filters.route}
            onChange={(event) => update({ route: event.target.value })}
          >
            <option value="">All assignments</option>
            <option value="unassigned">Route not supplied</option>
            {assignments.map((id) => {
              const route = data.routes.find((route) => route.id === id);
              return (
                <option key={id} value={`route:${id}`}>
                  {route ? `${route.number} ${route.name}` : `Reported route ${id}`}
                </option>
              );
            })}
          </select>
        </div>
        <div className="form-pair">
          <div className="form-control">
            <label htmlFor={`${id}-status`}>Position status</label>
            <select
              id={`${id}-status`}
              value={filters.status}
              onChange={(event) =>
                update({ status: event.target.value as FleetFilters['status'] })
              }
            >
              <option value="all">All reports</option>
              <option value="fresh">Fresh only</option>
              <option value="stale">Stale only</option>
              <option value="off-track">Off mapped track</option>
            </select>
          </div>
          <div className="form-control">
            <label htmlFor={`${id}-sort`}>Sort cars</label>
            <select
              id={`${id}-sort`}
              value={sort}
              onChange={(event) =>
                update({ sort: event.target.value as FleetFilters['sort'] })
              }
            >
              <option value="number">Car number</option>
              <option value="speed">Reported speed</option>
              <option value="distance" disabled={!location}>
                Distance from me
              </option>
            </select>
          </div>
        </div>
      </div>
      <div className="section-heading">
        <p role="status" className="fleet-count">
          {snapshot
            ? `${results.length} of ${cars.length} reported cars`
            : active && !failed
              ? 'Loading the fleet…'
              : 'No snapshot loaded'}
        </p>
        <button
          className="text-button"
          onClick={() => {
            setFilters(DEFAULT_FLEET_FILTERS);
            setPage(0);
            setMessage('');
          }}
        >
          Reset filters
        </button>
      </div>
      <ul className="compact-list fleet-list">
        {results
          .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          .map(({ car, metres }) => {
            const route = data.routes.find((route) => route.id === car.vehicle.routeId);
            return (
              <li key={car.vehicle.id}>
                <button className="list-choice" onClick={() => onSelect(car)}>
                  <strong>
                    Car {car.vehicle.label}
                    <span className={`report-tag ${car.stale ? 'stale' : ''}`}>
                      {car.stale ? 'Stale' : 'Fresh'}
                    </span>
                  </strong>
                  <small>
                    {route
                      ? `${route.number} ${route.name}`
                      : car.vehicle.routeId
                        ? `Reported route ${car.vehicle.routeId}`
                        : 'Route not supplied'}
                    {!car.match && ' · Off mapped track'}
                  </small>
                  <small>
                    {car.vehicle.speedMetresPerSecond !== undefined
                      ? `${Math.round(car.vehicle.speedMetresPerSecond * 3.6)} km/h reported`
                      : 'Speed not supplied'}
                    {metres !== undefined && ` · ${formatDistance(metres)} from you`}
                  </small>
                </button>
              </li>
            );
          })}
      </ul>
      {snapshot && !results.length && (
        <p className="tip">
          No cars match these filters. Try another assignment or position status.
        </p>
      )}
      {pages > 1 && (
        <nav className="fleet-pagination" aria-label="Fleet pages">
          <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {pages}
          </span>
          <button
            disabled={currentPage + 1 === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </nav>
      )}
      <button
        className="action-button export-fleet"
        disabled={!snapshot || !results.length}
        onClick={download}
      >
        ↓ Download filtered snapshot (.csv)
      </button>
      <p role="status" className="microcopy">
        {message}
      </p>
      {snapshot && (
        <p className="microcopy">
          Snapshot fetched{' '}
          {new Date(snapshot.fetchedAt).toLocaleTimeString('en-CA', {
            timeZone: 'America/Toronto',
          })}
          . CSV includes report times and freshness; it contains no personal location.
        </p>
      )}
    </section>
  );
}
