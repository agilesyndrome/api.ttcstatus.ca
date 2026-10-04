import type { Feature, ViewerData } from '../../map/model';

interface Props { data: ViewerData; ids: string[]; persistent: boolean; onSelect(feature: Feature): void; onRemove(id: string): void }
export function MyStops({ data, ids, persistent, onSelect, onRemove }: Props) {
  const stops = ids.map(id => ({ id, feature: data.features.find(feature => feature.id === id) }));
  return <section className="my-stops" aria-label="Saved stops"><div className="section-heading"><h2>★ My stops</h2><small>{ids.length}/100</small></div>
    {stops.length ? <ul className="compact-list">{stops.map(({ id, feature }) => <li key={id}><button className="list-choice" onClick={() => feature && onSelect(feature)} disabled={!feature}><strong>{feature?.name ?? 'Stop no longer in this map'}</strong><small>{feature ? feature.routeIds.map(id => data.routes.find(route => route.id === id)?.number).filter(Boolean).join(' · ') || 'Physical terminal' : 'Remove this bookmark and choose a current stop.'}</small></button><button className="remove-stop" aria-label={`Remove ${feature?.name ?? 'unavailable stop'} from saved stops`} onClick={() => onRemove(id)}>×</button></li>)}</ul>
      : <p className="helper">Your everyday stops, one tap away. Select a stop and choose “Save stop”.</p>}
    <p className="microcopy">{persistent ? 'Saved on this browser.' : 'Browser storage unavailable; saved for this visit.'}</p>
  </section>;
}
