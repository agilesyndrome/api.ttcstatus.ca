import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { arrivalCountdown, stationArrivals } from './arrivals';

interface Props {
  data: ViewerData;
  feature: Feature;
  snapshot?: VehicleSnapshot;
  now: number;
  enabled?: boolean;
  failed?: boolean;
}

export function StationArrivals({
  data,
  feature,
  snapshot,
  now,
  enabled,
  failed,
}: Props) {
  const arrivals = snapshot ? stationArrivals(data, feature, snapshot, now) : [];
  const unavailable = snapshot?.subwayStatus === 'unavailable' || (!snapshot && failed);
  return (
    <section className="station-arrivals" aria-label="Station arrivals">
      <h2>Upcoming trains</h2>
      <p className="microcopy">
        Subway / LRT predictions for this stop. Times may change; check station displays.
      </p>
      {!enabled ? (
        <p>Enable live vehicles to see arrival predictions.</p>
      ) : unavailable ? (
        <p role="status">Subway arrival predictions are temporarily unavailable.</p>
      ) : !snapshot ? (
        <p role="status">Waiting for arrival predictions…</p>
      ) : (
        <>
          {failed && (
            <p role="status">Refresh unavailable; showing recent predictions.</p>
          )}
          {arrivals.length ? (
            <ol className="compact-list arrival-list">
              {arrivals.map(({ train, arrivalAt, onward }) => (
                <li key={train.id}>
                  <div>
                    <strong>
                      Line{' '}
                      {data.routes.find((route) => route.id === train.routeId)?.number ??
                        train.routeId}
                      {' · '}Train {train.label}
                    </strong>
                    <small>{onward ? `Then ${onward}` : 'Direction not supplied'}</small>
                  </div>
                  <div className="arrival-time">
                    <strong>{arrivalCountdown(arrivalAt, now)}</strong>
                    <time dateTime={arrivalAt}>
                      {new Date(arrivalAt).toLocaleTimeString('en-CA', {
                        timeZone: 'America/Toronto',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p role="status">
              No fresh upcoming predictions for this stop. This does not mean service has
              ended.
            </p>
          )}
        </>
      )}
    </section>
  );
}
