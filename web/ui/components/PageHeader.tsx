import { useId, useState, type ReactNode } from 'react';
import { searchFeatures, type Feature, type ViewerData } from '../../../shared/map/model';
import type { PlottedVehicle } from '../../../shared/map/live-status';

interface Props {
  data?: ViewerData;
  cars?: PlottedVehicle[];
  actions?: ReactNode;
  onSelect(feature: Feature): void;
  onSelectVehicle(car: PlottedVehicle): void;
  onReset(): void;
}
export function PageHeader({
  data,
  cars = [],
  actions,
  onSelect,
  onSelectVehicle,
  onReset,
}: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const matches = data ? searchFeatures(data.features, data.routes, query) : [];
  const number = query.trim().replace(/^(?:streetcar|car|train)\s*#?\s*|^#\s*/i, '');
  const matchingCars = /^\d+$/.test(number)
    ? cars
        .filter(
          (car) =>
            car.vehicle.id.startsWith(number) || car.vehicle.label.startsWith(number),
        )
        .sort(
          (a, b) =>
            Number(b.vehicle.id === number || b.vehicle.label === number) -
              Number(a.vehicle.id === number || a.vehicle.label === number) ||
            a.vehicle.id.localeCompare(b.vehicle.id),
        )
        .slice(0, 6)
    : [];
  function closeSearch(selected = false) {
    setQuery('');
    if (selected && window.matchMedia('(max-width: 640px)').matches) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    } else document.getElementById(id)?.focus();
  }
  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        onClick={(event) => {
          event.preventDefault();
          setQuery('');
          onReset();
        }}
      >
        <span className="brand-symbol" aria-hidden="true">
          ↔
        </span>
        <span>
          <strong>Toronto rail map</strong>
          <small>A city on rails</small>
        </span>
      </a>
      <div className="search">
        <label className="sr-only" htmlFor={id}>
          Search stops, stations, routes or vehicle numbers
        </label>
        <span aria-hidden="true">⌕</span>
        <input
          id={id}
          type="search"
          placeholder="Find a stop, route or vehicle number…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-controls={`${id}-results`}
          aria-expanded={Boolean(query.trim())}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
            if (event.key === 'ArrowDown' || event.key === 'Enter') {
              const first = document
                .getElementById(`${id}-results`)
                ?.querySelector('button');
              if (first) {
                event.preventDefault();
                if (event.key === 'Enter') first.click();
                else first.focus();
              }
            }
          }}
        />
        {query.trim() && (
          <div
            id={`${id}-results`}
            className="search-results"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll('button'),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            {matchingCars.map((car) => {
              const route = data?.routes.find(
                (route) => route.id === car.vehicle.routeId,
              );
              return (
                <button
                  key={`car:${car.vehicle.id}`}
                  onClick={() => {
                    onSelectVehicle(car);
                    closeSearch(true);
                  }}
                >
                  {car.vehicle.mode === 'subway' ? 'Train' : 'Streetcar'}{' '}
                  {car.vehicle.label}
                  <small>
                    {route ? `${route.number} ${route.name}` : 'Route not supplied'}
                    {car.stale && ' · Stale position'}
                  </small>
                </button>
              );
            })}
            {matches.map((feature) => (
              <button
                key={`stop:${feature.id}`}
                onClick={() => {
                  onSelect(feature);
                  closeSearch(true);
                }}
              >
                {feature.name}
                <small>
                  {feature.routeIds
                    .map((id) => data?.routes.find((route) => route.id === id)?.number)
                    .join(' · ') || 'Physical terminal'}
                </small>
              </button>
            ))}
            {!matches.length && !matchingCars.length && (
              <p>No matching stops or vehicles. Try a stop, route or vehicle number.</p>
            )}
          </div>
        )}
      </div>
      {actions ?? <span className="snapshot">TTC status map</span>}
    </header>
  );
}
