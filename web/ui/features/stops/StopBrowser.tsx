import { useId, useMemo, useState } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import { formatDistance, type Location } from '../../commute';
import { DEFAULT_STOP_FILTERS, filterStops, type StopFilters } from './stops';
interface Props {
  data: ViewerData;
  savedIds: string[];
  location?: Location;
  onSelect(stop: Feature): void;
}
export function StopBrowser({ data, savedIds, location, onSelect }: Props) {
  const id = useId();
  const [filters, setFilters] = useState(DEFAULT_STOP_FILTERS);
  const [page, setPage] = useState(0);
  const matches = useMemo(
    () => filterStops(data, filters, savedIds, location),
    [data, filters, savedIds, location],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 20) - 1));
  const change = (next: Partial<StopFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  };
  return (
    <section className="stop-browser">
      <p className="eyebrow">Every corner has a story</p>
      <h1>Find your stop.</h1>
      <p className="helper">
        Browse boarding stops, stations and physical terminals in the published map.
        Overnight routes are included in this directory.
      </p>
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={id + '-query'}>Search stops</label>
          <input
            id={id + '-query'}
            type="search"
            value={filters.query}
            placeholder="Stop, street or route name"
            onChange={(event) => change({ query: event.target.value })}
          />
        </div>
        <div className="form-control">
          <label htmlFor={id + '-route'}>Stop route</label>
          <select
            id={id + '-route'}
            value={filters.route}
            onChange={(event) => change({ route: event.target.value })}
          >
            <option value="">All routes</option>
            {data.routes
              .filter((route) => route.scheduled)
              .map((route) => (
                <option key={route.id} value={route.id}>
                  {route.number} {route.name}
                  {route.overnight ? ' · overnight' : ''}
                </option>
              ))}
          </select>
        </div>
        <div className="form-pair">
          <div className="form-control">
            <label htmlFor={id + '-kind'}>Stop type</label>
            <select
              id={id + '-kind'}
              value={filters.kind}
              onChange={(event) =>
                change({ kind: event.target.value as StopFilters['kind'] })
              }
            >
              <option value="boarding">Boarding stops</option>
              <option value="terminal">Stations / terminals</option>
              <option value="all">All map places</option>
            </select>
          </div>
          <div className="form-control">
            <label htmlFor={id + '-sort'}>Sort stops</label>
            <select
              id={id + '-sort'}
              value={filters.sort === 'distance' && !location ? 'name' : filters.sort}
              onChange={(event) =>
                change({ sort: event.target.value as StopFilters['sort'] })
              }
            >
              <option value="name">Name</option>
              <option value="distance" disabled={!location}>
                Distance from me
              </option>
            </select>
          </div>
        </div>
        <label className="accessible-filter">
          <input
            type="checkbox"
            checked={filters.accessible}
            onChange={(event) => change({ accessible: event.target.checked })}
          />{' '}
          Listed accessible boarding
        </label>
        <label className="accessible-filter">
          <input
            type="checkbox"
            checked={filters.saved}
            onChange={(event) => change({ saved: event.target.checked })}
          />{' '}
          Saved stops only
        </label>
      </div>
      <p className="fleet-count" role="status">
        {matches.length} {matches.length === 1 ? 'place' : 'places'} found
      </p>
      <ul className="compact-list">
        {matches
          .slice(currentPage * 20, currentPage * 20 + 20)
          .map(({ stop, metres }) => (
            <li key={stop.id}>
              <button className="list-choice" onClick={() => onSelect(stop)}>
                <strong>
                  {savedIds.includes(stop.id) && <span aria-label="Saved">★ </span>}
                  {stop.name}
                  {metres !== undefined && (
                    <span className="distance">{formatDistance(metres)}</span>
                  )}
                </strong>
                <small>
                  {stop.boardingPoints
                    ? stop.routeIds
                        .map(
                          (routeId) =>
                            data.routes.find((route) => route.id === routeId)?.number ??
                            routeId,
                        )
                        .join(' · ') +
                      ' · ' +
                      stop.boardingPoints +
                      ' boarding points'
                    : 'Physical terminal · no scheduled boarding records'}
                </small>
                {stop.accessible === true && <small>Accessible boarding listed</small>}
              </button>
            </li>
          ))}
      </ul>
      {!matches.length && (
        <p className="helper">
          No places match these filters. Try another street or broaden your search.
        </p>
      )}
      {matches.length > 20 && (
        <div className="fleet-pagination">
          <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            Previous stops
          </button>
          <span>
            Page {currentPage + 1} of {Math.ceil(matches.length / 20)}
          </span>
          <button
            disabled={(currentPage + 1) * 20 >= matches.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next stops
          </button>
        </div>
      )}
      <button
        className="action-button"
        onClick={() => {
          setFilters(DEFAULT_STOP_FILTERS);
          setPage(0);
        }}
      >
        Reset stop filters
      </button>
      <p className="microcopy">
        Accessibility comes from the static feed and may apply to only one boarding point.
        Distance is straight-line GPS distance. Enable Near me in Explore to sort by
        distance.
      </p>
    </section>
  );
}
