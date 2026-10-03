import { useId, useState } from 'react';
import { searchFeatures, type Feature, type ViewerData } from '../../map/model';

interface Props { data?: ViewerData; onSelect(feature: Feature): void; onReset(): void }
export function PageHeader({ data, onSelect, onReset }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const matches = data ? searchFeatures(data.features, data.routes, query) : [];
  return <header className="topbar">
    <a className="brand" href="/" onClick={event => { event.preventDefault(); setQuery(''); onReset(); }}><span className="brand-symbol" aria-hidden="true">↔</span><span><strong>Toronto streetcars</strong><small>A city on rails</small></span></a>
    <div className="search"><label className="sr-only" htmlFor={id}>Search stops, stations or routes</label><span aria-hidden="true">⌕</span>
      <input id={id} type="search" placeholder="Find a stop, station or route…" value={query} onChange={event => setQuery(event.target.value)} aria-controls={`${id}-results`} aria-expanded={Boolean(query.trim())} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); if (event.key === 'ArrowDown') document.getElementById(`${id}-results`)?.querySelector('button')?.focus(); }} />
      {query.trim() && <div id={`${id}-results`} className="search-results">{matches.map(feature => <button key={feature.id} onClick={() => { onSelect(feature); setQuery(''); }}>{feature.name}<small>{feature.routeIds.map(id => data?.routes.find(route => route.id === id)?.number).join(' · ') || 'Physical terminal'}</small></button>)}{!matches.length && <p>No matching stops. Try a street name or route number.</p>}</div>}
    </div>
    <span className="snapshot">TTC status map</span>
  </header>;
}
