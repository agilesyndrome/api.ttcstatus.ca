import type { CSSProperties } from 'react';
import type { PlottedVehicle } from '../../map/live-status';
import type { Route } from '../../map/model';
import { routeActivity } from '../commute';

interface Props { routes: Route[]; cars: PlottedVehicle[]; loaded: boolean; active: boolean; failed: boolean; selectedRoute?: string; onSelect(id: string): void }
export function RoutePulse({ routes, cars, loaded, active, failed, selectedRoute, onSelect }: Props) {
  const entries = routes.filter(route => route.scheduled).map(route => ({ route, ...routeActivity(route, cars) }));
  const selected = entries.find(entry => entry.route.id === selectedRoute);
  const fresh = cars.filter(car => !car.stale).length;
  const peak = Math.max(1, ...entries.map(entry => entry.fresh));
  return <section className="route-pulse" aria-label="Route activity"><p className="eyebrow">The city in motion</p><div className="section-heading"><h2>Route pulse</h2><span className="pulse-total">{loaded ? `${fresh} fresh fixes` : 'Waiting for feed'}</span></div>
    <p className="helper">{!loaded ? 'Turn on live streetcars to see route activity.' : !active ? 'Updates paused. Showing the last snapshot.' : failed ? 'Refresh unavailable. Showing the last snapshot.' : 'Fresh vehicle reports by route.'}</p>
    {loaded && <div className="pulse-bars">{entries.map(entry => <button key={entry.route.id} className="pulse-row" style={{ '--route-color': entry.route.color } as CSSProperties} aria-pressed={selectedRoute === entry.route.id} aria-label={`${entry.route.number} ${entry.route.name}: ${entry.fresh} fresh, ${entry.stale} stale vehicle reports`} onClick={() => onSelect(entry.route.id)}><span>{entry.route.number}</span><span className="pulse-track"><span style={{ width: `${entry.fresh / peak * 100}%` }} /></span><strong>{entry.fresh}</strong></button>)}</div>}
    {selected && loaded && <div className="pulse-detail"><strong>{selected.route.number} {selected.route.name}</strong><p>{selected.reported} reported · {selected.stale} stale</p><p>{selected.medianSpeed === undefined ? 'Speed not supplied for fresh reports.' : `${Math.round(selected.medianSpeed)} km/h median reported speed`}</p></div>}
    <p className="microcopy">Vehicle counts describe this feed, not service frequency or delays.</p>
  </section>;
}
