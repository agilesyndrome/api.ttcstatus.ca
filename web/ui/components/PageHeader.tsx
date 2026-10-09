import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { useId, useState, type ReactNode } from 'react';
import { searchFeatures, type Feature, type ViewerData } from '../../../shared/map/model';
import type { PlottedVehicle } from '../../../shared/map/live-status';

interface Props {
  data?: ViewerData;
  cars?: PlottedVehicle[];
  actions?: ReactNode;
  /** Makes the brand symbol a menu button: on mobile it toggles the nav
   * panel; the current open state feeds its aria-expanded announcement. */
  onBrandToggle?(): void;
  navOpen?: boolean;
  onSelect(feature: Feature): void;
  onSelectVehicle(car: PlottedVehicle): void;
  onReset(): void;
}
export function PageHeader({
  data,
  cars = [],
  actions,
  onBrandToggle,
  navOpen,
  onSelect,
  onSelectVehicle,
  onReset,
}: Props) {
  useLanguage();
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
        {onBrandToggle ? (
          <span
            className="brand-symbol brand-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={navOpen}
            aria-label={navOpen ? t('header.closeMenu') : t('header.openMenu')}
            onClick={(event) => {
              // Keep this press on the symbol: the surrounding brand link
              // would otherwise reset the view (and navigate).
              event.stopPropagation();
              event.preventDefault();
              onBrandToggle();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onBrandToggle();
              }
            }}
          >
            ↔
          </span>
        ) : (
          <span className="brand-symbol" aria-hidden="true">
            ↔
          </span>
        )}
        <span>
          <strong>{t('header.title')}</strong>
          <small>{t('header.tagline')}</small>
        </span>
      </a>
      <div className="search">
        <label className="sr-only" htmlFor={id}>
          {t('header.searchStopsStationsRoutesOrVehicleNumbers')}
        </label>
        <span aria-hidden="true">⌕</span>
        <input
          id={id}
          type="search"
          placeholder={t('header.findAStopRouteOrVehicleNumber')}
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
                  {car.vehicle.mode === 'subway'
                    ? t('viewer.train')
                    : t('header.streetcar')}{' '}
                  {car.vehicle.label}
                  <small>
                    {route
                      ? `${route.number} ${route.name}`
                      : t('header.routeNotSupplied')}
                    {car.stale && t('viewer.stalePosition')}
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
                    .join(' · ') || t('header.physicalTerminal')}
                </small>
              </button>
            ))}
            {!matches.length && !matchingCars.length && (
              <p>{t('header.noMatchingStopsOrVehiclesTryAStopRouteOr')}</p>
            )}
          </div>
        )}
      </div>
      {actions ?? <span className="snapshot">{t('header.ttcStatusMap')}</span>}
    </header>
  );
}
