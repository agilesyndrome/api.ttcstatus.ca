import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { Feature, Route, ViewerData } from '../../../../shared/map/model';
import { routeItineraries } from './route-guide';

interface Props {
  data: ViewerData;
  route: Route;
  savedIds: string[];
  onSelect(feature: Feature): void;
  onCompare(fromId: string, toId: string): void;
  onClose(): void;
}

export function RouteGuide({
  data,
  route,
  savedIds,
  onSelect,
  onCompare,
  onClose,
}: Props) {
  const id = useId();
  const itineraries = useMemo(() => routeItineraries(data, route.id), [data, route.id]);
  const [choice, setChoice] = useState('');
  const [query, setQuery] = useState('');
  const itinerary = itineraries.find((item) => item.key === choice) ?? itineraries[0];
  const needle = query.trim().toLocaleLowerCase();
  const stops =
    itinerary?.stops.filter(({ feature }) =>
      feature.name.toLocaleLowerCase().includes(needle),
    ) ?? [];
  const first = itinerary?.stops[0]?.feature;
  const last = itinerary?.stops.at(-1)?.feature;
  return (
    <section
      className="route-guide"
      aria-label="Route stop guide"
      style={{ '--route-color': route.color } as CSSProperties}
    >
      <p className="eyebrow">One route, stop by stop</p>
      <div className="details-heading">
        <h1>
          <span className="guide-route-number">{route.number}</span> {route.name}
        </h1>
        <button
          className="close-details"
          aria-label="Close route guide"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {route.overnight && <p className="tip">Overnight route</p>}
      {itinerary ? (
        <>
          <div className="tool-form">
            <div className="form-control">
              <label htmlFor={`${id}-pattern`}>Scheduled direction / variant</label>
              <select
                id={`${id}-pattern`}
                value={itinerary.key}
                onChange={(event) => {
                  setChoice(event.target.value);
                  setQuery('');
                }}
              >
                {itineraries.map((item, index) => (
                  <option key={item.key} value={item.key}>
                    {index + 1}. {item.headsign || 'Destination not supplied'} ·{' '}
                    {item.boardingPoints} boarding points
                  </option>
                ))}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor={`${id}-query`}>Find on this route</label>
              <input
                id={`${id}-query`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Station or street name"
              />
            </div>
          </div>
          <p className="helper">
            Mapped stops: {first?.name ?? 'None'} → {last?.name ?? 'None'}
          </p>
          <p className="microcopy">
            Scheduled stop order, not a live service guarantee. Variants may run at
            different times; current diversions and departure times are not included.
          </p>
          {itinerary.unmapped > 0 && (
            <p className="tip">
              {itinerary.unmapped} boarding{' '}
              {itinerary.unmapped === 1 ? 'point is' : 'points are'} not shown on this
              map. The list may have gaps.
            </p>
          )}
          {first && last && first.id !== last.id && (
            <button
              className="action-button"
              onClick={() => onCompare(first.id, last.id)}
            >
              Compare first and last mapped stops
            </button>
          )}
          <p className="fleet-count" role="status">
            {stops.length} of {itinerary.stops.length} mapped stops
          </p>
          <ol className="route-stop-list">
            {stops.map(({ feature, sequence }) => (
              <li key={sequence}>
                <span
                  className="guide-sequence"
                  aria-label={`Boarding sequence ${sequence}`}
                >
                  {sequence}
                </span>
                <button className="list-choice" onClick={() => onSelect(feature)}>
                  <strong>
                    {savedIds.includes(feature.id) && <span aria-label="Saved">★ </span>}
                    {feature.name}
                  </strong>
                  <small>
                    {feature.accessible ? 'Accessible boarding listed · ' : ''}View stop
                    details →
                  </small>
                </button>
              </li>
            ))}
          </ol>
          {!stops.length && (
            <p className="helper">
              {query
                ? 'No stops match this search. Try another street or station.'
                : 'No boarding points in this variant are mapped.'}
            </p>
          )}
        </>
      ) : (
        <p className="tip">
          Ordered stop information is unavailable for this route in the current map.
        </p>
      )}
    </section>
  );
}
