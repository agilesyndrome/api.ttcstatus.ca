import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { savedStopStatus } from './saved-stop-status';
import { BookmarkBackup } from './BookmarkBackup';

interface Props {
  data: ViewerData;
  ids: string[];
  persistent: boolean;
  onSelect(feature: Feature): void;
  onRemove(id: string): void;
  onRestore?(ids: string[]): void;
  snapshot?: VehicleSnapshot;
  cars?: PlottedVehicle[];
  now?: number;
  enabled?: boolean;
  active?: boolean;
  failed?: boolean;
}
export function MyStops({
  data,
  ids,
  persistent,
  onSelect,
  onRemove,
  onRestore,
  snapshot,
  cars = [],
  now = Date.now(),
  enabled = false,
  active,
  failed,
}: Props) {
  const stops = ids.map((id) => ({
    id,
    feature: data.features.find((feature) => feature.id === id),
  }));
  return (
    <section className="my-stops" aria-label="Saved stops">
      <div className="section-heading">
        <h2>★ My stops</h2>
        <small>{ids.length}/100</small>
      </div>
      {stops.length ? (
        <ul className="compact-list">
          {stops.map(({ id, feature }) => (
            <li key={id}>
              <button
                className="list-choice"
                onClick={() => feature && onSelect(feature)}
                disabled={!feature}
              >
                <strong>{feature?.name ?? 'Stop no longer in this map'}</strong>
                <small>
                  {feature
                    ? feature.routeIds
                        .map((id) => data.routes.find((route) => route.id === id)?.number)
                        .filter(Boolean)
                        .join(' · ') || 'Physical terminal'
                    : 'Remove this bookmark and choose a current stop.'}
                </small>
                {feature &&
                  savedStopStatus(data, feature, snapshot, cars, now, enabled).map(
                    (summary) => (
                      <small className="saved-live-summary" key={summary}>
                        {summary}
                      </small>
                    ),
                  )}
              </button>
              <button
                className="remove-stop"
                aria-label={`Remove ${feature?.name ?? 'unavailable stop'} from saved stops`}
                onClick={() => onRemove(id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="helper">
          Your everyday stops, one tap away. Select a stop and choose “Save stop”.
        </p>
      )}
      {stops.length > 0 && (
        <p className="microcopy">
          {enabled &&
            (failed ? 'Refresh unavailable. ' : !active ? 'Updates paused. ' : '')}
          Train times are predictions. Streetcar distances are proximity, not arrival
          times.
        </p>
      )}
      {onRestore && <BookmarkBackup data={data} ids={ids} onRestore={onRestore} />}
      <p className="microcopy">
        {persistent
          ? 'Saved on this browser.'
          : 'Browser storage unavailable; saved for this visit.'}
      </p>
    </section>
  );
}
