import { useId, useMemo } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import { formatDistance } from '../../commute';
import { compareStops } from './comparison';

export type PickingStop = 'from' | 'to';
interface Props {
  data: ViewerData;
  fromId?: string;
  toId?: string;
  picking?: PickingStop;
  includeOvernight: boolean;
  onChange(fromId?: string, toId?: string): void;
  onPick(value?: PickingStop): void;
  onOvernight(value: boolean): void;
  onRoute(id: string): void;
}
const boarding = (feature?: Feature) =>
  feature?.accessible
    ? 'Listed at one or more boarding points'
    : 'Not confirmed in this map';
export function StopComparison({
  data,
  fromId,
  toId,
  picking,
  includeOvernight,
  onChange,
  onPick,
  onOvernight,
  onRoute,
}: Props) {
  const id = useId();
  const stops = useMemo(
    () =>
      data.features
        .filter((feature) => feature.boardingPoints > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const from = stops.find((stop) => stop.id === fromId),
    to = stops.find((stop) => stop.id === toId);
  const comparison = useMemo(
    () => (from && to ? compareStops(data, from, to, includeOvernight) : undefined),
    [data, from, to, includeOvernight],
  );
  function change(nextFrom?: string, nextTo?: string) {
    onPick(undefined);
    onChange(nextFrom, nextTo);
  }
  return (
    <section className="stop-comparison" aria-label="Stop comparison">
      <p className="eyebrow">Two stops, one city</p>
      <h1>Compare stops</h1>
      <p className="helper">
        Choose two boarding stops to compare distance, accessibility and scheduled route
        connections.
      </p>
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={`${id}-start`}>Start stop</label>
          <select
            id={`${id}-start`}
            value={from?.id ?? ''}
            onChange={(event) => change(event.target.value || undefined, toId)}
          >
            <option value="">Choose a start…</option>
            {stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="action-button"
          aria-pressed={picking === 'from'}
          onClick={() => onPick(picking === 'from' ? undefined : 'from')}
        >
          Pick start stop on map
        </button>
        <div className="form-control">
          <label htmlFor={`${id}-destination`}>Destination stop</label>
          <select
            id={`${id}-destination`}
            value={to?.id ?? ''}
            onChange={(event) => change(fromId, event.target.value || undefined)}
          >
            <option value="">Choose a destination…</option>
            {stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="action-button"
          aria-pressed={picking === 'to'}
          onClick={() => onPick(picking === 'to' ? undefined : 'to')}
        >
          Pick destination stop on map
        </button>
        <div className="comparison-actions">
          <button
            className="action-button"
            disabled={!from && !to}
            onClick={() => change(toId, fromId)}
          >
            ⇄ Swap stops
          </button>
          <button
            className="text-button"
            disabled={!fromId && !toId && !picking}
            onClick={() => change()}
          >
            Clear comparison
          </button>
        </div>
        <label className="accessible-filter">
          <input
            type="checkbox"
            checked={includeOvernight}
            onChange={(event) => onOvernight(event.target.checked)}
          />{' '}
          Include overnight connections
        </label>
      </div>
      {picking && (
        <p role="status" className="tip">
          Choose a {picking === 'from' ? 'start' : 'destination'} boarding stop on the
          map, or use the search above.{' '}
          <button className="text-button" onClick={() => onPick(undefined)}>
            Cancel picking
          </button>
        </p>
      )}
      {comparison && from && to ? (
        <div className="comparison-result" aria-live="polite">
          <div className="comparison-summary">
            <strong>{formatDistance(comparison.metres)}</strong>
            <small>Straight-line distance</small>
          </div>
          <dl className="stop-facts">
            <dt>A · {from.name}</dt>
            <dd>Accessible boarding: {boarding(from)}</dd>
            <dt>B · {to.name}</dt>
            <dd>Accessible boarding: {boarding(to)}</dd>
          </dl>
          <h2>Scheduled connections</h2>
          {comparison.sameStop ? (
            <p className="tip">
              You’ve chosen the same stop twice. Choose a different destination to
              compare.
            </p>
          ) : !comparison.available ? (
            <p className="tip">
              Route connections are unavailable for this map. Distance and boarding
              information are shown above.
            </p>
          ) : comparison.connections.length ? (
            <div className="connection-list">
              {comparison.connections.map((connection) => (
                <article key={connection.route.id} className="connection-card">
                  <button
                    className="action-button"
                    onClick={() => onRoute(connection.route.id)}
                  >
                    Highlight {connection.route.number} {connection.route.name}
                  </button>
                  <p>
                    {connection.minimumStopsBetween === connection.maximumStopsBetween
                      ? connection.minimumStopsBetween
                      : `${connection.minimumStopsBetween}–${connection.maximumStopsBetween}`}{' '}
                    {connection.maximumStopsBetween === 1 ? 'stop' : 'stops'} between
                    these boarding points{connection.route.overnight && ' · Overnight'}
                  </p>
                  {connection.headsigns.length > 0 && (
                    <details>
                      <summary>Scheduled destinations</summary>
                      <ul>
                        {connection.headsigns.map((headsign) => (
                          <li key={headsign}>{headsign}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="tip">
              No direct rail connection is listed in this direction
              {includeOvernight ? '' : ' on daytime routes'}. Try swapping stops or
              including overnight connections.
            </p>
          )}
          <p className="microcopy">
            Connections use routes in this map that serve the start before the
            destination. Service times, transfers and current diversions are not included.
          </p>
        </div>
      ) : (
        <p className="tip">
          Start and destination will appear as A and B on the map. Set both to see the
          comparison.
        </p>
      )}
    </section>
  );
}
