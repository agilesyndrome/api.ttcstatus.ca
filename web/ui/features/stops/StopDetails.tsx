import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import { formatDistance, nearbyCars } from '../../commute';
interface Props {
  data: ViewerData;
  feature?: Feature;
  car?: PlottedVehicle;
  cars?: PlottedVehicle[];
  saved?: boolean;
  saveLimit?: boolean;
  liveEnabled?: boolean;
  feedLoaded?: boolean;
  feedFailed?: boolean;
  journalSaved?: boolean;
  journalFull?: boolean;
  onJournal?(): void;
  onOpenJournal?(): void;
  following?: boolean;
  onFollow?(): void;
  onCompare?(end: 'from' | 'to'): void;
  onToggleSave?(): void;
  onSelectVehicle?(car: PlottedVehicle): void;
  onClose(): void;
}
export function StopDetails({
  data,
  feature,
  car,
  cars = [],
  saved,
  saveLimit,
  liveEnabled,
  feedLoaded,
  feedFailed,
  following,
  onFollow,
  journalSaved,
  journalFull,
  onJournal,
  onOpenJournal,
  onCompare,
  onToggleSave,
  onSelectVehicle,
  onClose,
}: Props) {
  if (car)
    return (
      <section id="details" aria-live="polite">
        <p className="eyebrow">Flexity streetcar</p>
        <div className="details-heading">
          <h1>Car {car.vehicle.label}</h1>
          <button
            className="close-details"
            aria-label="Close streetcar details"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p>
          {data.routes.find((route) => route.id === car.vehicle.routeId)?.name ??
            'Route not supplied'}
          {car.stale && ' · Stale position'}
        </p>
        <p>
          {car.match
            ? 'Position matched to mapped track.'
            : 'Off mapped track; showing GPS location.'}
        </p>
        <dl className="stop-facts">
          <dt>Position reported</dt>
          <dd>
            {car.vehicle.observedAt
              ? new Date(car.vehicle.observedAt).toLocaleString('en-CA', {
                  timeZone: 'America/Toronto',
                })
              : 'Time not supplied'}
          </dd>
          {car.vehicle.speedMetresPerSecond !== undefined && (
            <>
              <dt>Reported speed</dt>
              <dd>{Math.round(car.vehicle.speedMetresPerSecond * 3.6)} km/h</dd>
            </>
          )}
        </dl>
        {onFollow && (
          <>
            <button
              className="action-button follow-car"
              aria-pressed={Boolean(following)}
              onClick={onFollow}
            >
              {following ? '◎ Following this car' : '◎ Follow this car'}
            </button>
            {following && (
              <p className="microcopy">
                {car.stale
                  ? 'Waiting for a fresh position before moving the map.'
                  : 'Following fresh GPS fixes. Pan or zoom to pause following.'}
              </p>
            )}
          </>
        )}
        {onJournal && (
          <div className="journal-car-actions">
            <button
              className="action-button"
              disabled={journalSaved || journalFull}
              onClick={onJournal}
            >
              {journalSaved
                ? '✓ In your journal'
                : journalFull
                  ? 'Journal full · 500 cars'
                  : '✦ Add to journal'}
            </button>
            {onOpenJournal && (
              <button className="text-button" onClick={onOpenJournal}>
                Open journal →
              </button>
            )}
            <p className="microcopy">
              Manually collect this car number. Saved in this browser, without GPS
              coordinates.
            </p>
          </div>
        )}
      </section>
    );
  if (!feature)
    return (
      <section id="details">
        <p className="eyebrow">Explore Toronto</p>
        <h1>Follow the city’s tracks.</h1>
        <p>From Long Branch to the Beaches, explore the network one stop at a time.</p>
        <div className="stats">
          <div>
            <strong>{data.features.length}</strong>
            <small>stops &amp; terminals</small>
          </div>
          <div>
            <strong>{data.routes.filter((route) => !route.overnight).length}</strong>
            <small>daytime routes</small>
          </div>
        </div>
        <p className="tip">
          Select a stop or streetcar for details. Use the route legend to highlight a
          route.
        </p>
      </section>
    );
  const nearby = nearbyCars(data, feature, cars);
  return (
    <section id="details" aria-live="polite">
      <p className="eyebrow">
        {feature.kind === 'terminal' ? 'Station / terminal' : 'Streetcar stop'}
      </p>
      <div className="details-heading">
        <h1>{feature.name}</h1>
        <button
          className="close-details"
          aria-label="Close stop details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p>
        {feature.routeIds.length
          ? feature.routeIds
              .map((id) => {
                const route = data.routes.find((route) => route.id === id);
                return route ? `${route.number} ${route.name}` : id;
              })
              .join(' · ')
          : 'Physical terminal without scheduled streetcar boarding records.'}
      </p>
      {onToggleSave && (
        <>
          <button
            className="action-button save-stop"
            aria-pressed={Boolean(saved)}
            disabled={!saved && saveLimit}
            onClick={onToggleSave}
          >
            {saved ? '★ Saved stop' : '☆ Save stop'}
          </button>
          {!saved && saveLimit && (
            <p className="microcopy">
              Your 100 saved stops are full. Remove a stop to save another.
            </p>
          )}
        </>
      )}
      <dl className="stop-facts">
        <dt>Boarding points</dt>
        <dd>{feature.boardingPoints}</dd>
        <dt>Accessible boarding</dt>
        <dd>
          {feature.accessible
            ? 'Listed at one or more boarding points'
            : 'Not confirmed in this snapshot'}
        </dd>
      </dl>
      {onCompare && feature.boardingPoints > 0 && (
        <div className="comparison-actions">
          <button className="action-button" onClick={() => onCompare('from')}>
            Compare from here
          </button>
          <button className="action-button" onClick={() => onCompare('to')}>
            Compare to here
          </button>
        </div>
      )}
      {onSelectVehicle && feature.boardingPoints > 0 && (
        <div className="stop-cars">
          <h2>Streetcars nearby</h2>
          <p className="microcopy">
            Fresh reports on this stop’s routes within 2 km. Straight-line distance; cars
            may be travelling either way. These are not arrival predictions.
          </p>
          {!liveEnabled ? (
            <p>Enable live streetcars to see nearby cars.</p>
          ) : !feedLoaded ? (
            <p>
              {feedFailed
                ? 'Live positions unavailable.'
                : 'Waiting for vehicle positions…'}
            </p>
          ) : (
            <>
              {feedFailed && <p>Refresh unavailable; showing the last snapshot.</p>}
              {nearby.length ? (
                <ul className="compact-list">
                  {nearby.map(({ car, metres }) => (
                    <li key={car.vehicle.id}>
                      <button
                        className="list-choice"
                        onClick={() => onSelectVehicle(car)}
                      >
                        <strong>
                          Car {car.vehicle.label}
                          <span className="distance">{formatDistance(metres)}</span>
                        </strong>
                        <small>
                          {
                            data.routes.find((route) => route.id === car.vehicle.routeId)
                              ?.number
                          }{' '}
                          · View on map
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No fresh cars reported nearby on these routes.</p>
              )}
            </>
          )}
        </div>
      )}
      {Object.values(feature.destinations).flat().length > 0 && (
        <details>
          <summary>Scheduled destinations</summary>
          <ul>
            {[...new Set(Object.values(feature.destinations).flat())].map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
