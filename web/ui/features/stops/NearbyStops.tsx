import { useEffect, useRef, useState } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import { formatDistance, nearbyStops, type Location } from '../../commute';

interface Props {
  data: ViewerData;
  location?: Location;
  onLocate(location: Location): void;
  onClear(): void;
  onSelect(feature: Feature): void;
}
export function NearbyStops({ data, location, onLocate, onClear, onSelect }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [accessible, setAccessible] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const stops = location ? nearbyStops(data, location, accessible) : [];
  function locate() {
    if (!navigator.geolocation) {
      setError(
        'Location is unavailable in this browser. You can search for a stop above.',
      );
      return;
    }
    const current = ++request.current;
    setPending(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (current !== request.current) return;
        setPending(false);
        onLocate({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (current !== request.current) return;
        setPending(false);
        setError(
          error.code === 1
            ? 'Location permission was declined. You can still search for a stop above.'
            : error.code === 3
              ? 'Location took too long. Try again or search for a stop.'
              : 'Your location could not be found. Try again or search for a stop.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }
  return (
    <section className="nearby-stops" aria-label="Nearby stops">
      <div className="section-heading">
        <h2>◎ Near me</h2>
        {location && (
          <button
            className="text-button"
            onClick={() => {
              request.current++;
              setPending(false);
              setError('');
              onClear();
            }}
          >
            Clear location
          </button>
        )}
      </div>
      <button className="action-button" onClick={locate} disabled={pending}>
        {pending
          ? 'Finding your location…'
          : location
            ? 'Refresh & recenter map'
            : 'Locate me & center map'}
      </button>
      {!location && !pending && (
        <p className="microcopy">
          Centers the map on your approximate location at a neighborhood zoom.
        </p>
      )}
      {error && (
        <p role="alert" className="helper">
          {error}
        </p>
      )}
      {location ? (
        <>
          <label className="accessible-filter">
            <input
              type="checkbox"
              checked={accessible}
              onChange={(event) => setAccessible(event.target.checked)}
            />{' '}
            Listed accessible boarding only
          </label>
          {stops.length ? (
            <ul className="compact-list">
              {stops.map(({ feature, metres }) => (
                <li key={feature.id}>
                  <button className="list-choice" onClick={() => onSelect(feature)}>
                    <strong>{feature.name}</strong>
                    <small>
                      {formatDistance(metres)} away ·{' '}
                      {feature.routeIds
                        .map((id) => data.routes.find((route) => route.id === id)?.number)
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="helper">
              No {accessible ? 'stops with listed accessible boarding' : 'boarding stops'}{' '}
              within 2.5 km. Try searching for a stop or changing the filter.
            </p>
          )}
          <p className="microcopy">
            Straight-line distances.
            {location.accuracy !== undefined &&
              ` Location accuracy ±${formatDistance(location.accuracy)}.`}{' '}
            Your location stays in this tab.
          </p>
        </>
      ) : (
        <p className="microcopy">
          Use your location to find boarding stops within 2.5 km.
        </p>
      )}
    </section>
  );
}
