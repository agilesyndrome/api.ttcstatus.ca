import type { CSSProperties } from 'react';
import type { Route } from '../../../../shared/map/model';
interface Props {
  routes: Route[];
  selectedRoute?: string;
  onSelect(id?: string): void;
}
export function RouteLegend({ routes, selectedRoute, onSelect }: Props) {
  return (
    <section className="route-section">
      <div className="section-heading">
        <h2>Explore a route</h2>
        {selectedRoute && (
          <button className="text-button" onClick={() => onSelect(undefined)}>
            Show all
          </button>
        )}
      </div>
      <div className="route-list">
        {routes.map((route) => (
          <button
            key={route.id}
            className="route-button"
            style={{ '--route-color': route.color } as CSSProperties}
            aria-pressed={selectedRoute === route.id}
            disabled={!route.scheduled}
            title={
              !route.scheduled
                ? 'No scheduled streetcar service in this snapshot'
                : undefined
            }
            onClick={() => onSelect(selectedRoute === route.id ? undefined : route.id)}
          >
            <span className="route-number">{route.number}</span>
            <span className="route-name">{route.name}</span>
            {(route.overnight || !route.scheduled) && (
              <small className="route-state">
                {route.overnight ? 'OVERNIGHT' : 'RAIL ONLY'}
              </small>
            )}
          </button>
        ))}
      </div>
      <p className="legend-note">
        <span className="dashed-swatch" />
        Physical track without scheduled streetcar service
      </p>
    </section>
  );
}
