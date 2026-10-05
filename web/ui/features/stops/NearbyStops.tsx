import { english } from '../../../../shared/i18n/messages';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
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
  useLanguage();
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
      setError(english('nearbyStops.locationIsUnavailableInThisBrowserYouCanSearchFor'));
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
            ? english('nearbyStops.locationPermissionWasDeclinedYouCanStillSearchForA')
            : error.code === 3
              ? english('nearbyStops.locationTookTooLongTryAgainOrSearchForA')
              : english('nearbyStops.yourLocationCouldNotBeFoundTryAgainOrSearch'),
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }
  return (
    <section className="nearby-stops" aria-label={t('nearbyStops.nearbyStops')}>
      <div className="section-heading">
        <h2>{t('nearbyStops.nearMe')}</h2>
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
            {t('nearbyStops.clearLocation')}
          </button>
        )}
      </div>
      <button className="action-button" onClick={locate} disabled={pending}>
        {pending
          ? t('nearbyStops.findingYourLocation')
          : location
            ? t('nearbyStops.refreshRecenterMap')
            : t('nearbyStops.locateMeCenterMap')}
      </button>
      {!location && !pending && (
        <p className="microcopy">
          {t('nearbyStops.centersTheMapOnYourApproximateLocationAtANeighborhood')}
        </p>
      )}
      {error && (
        <p role="alert" className="helper">
          {t(error)}
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
            {t('nearbyStops.listedAccessibleBoardingOnly')}
          </label>
          {stops.length ? (
            <ul className="compact-list">
              {stops.map(({ feature, metres }) => (
                <li key={feature.id}>
                  <button className="list-choice" onClick={() => onSelect(feature)}>
                    <strong>{feature.name}</strong>
                    <small>
                      {formatDistance(metres)} {t('nearbyStops.away')}{' '}
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
              {t('nearbyStops.no')}{' '}
              {accessible
                ? t('nearbyStops.stopsWithListedAccessibleBoarding')
                : t('nearbyStops.boardingStops')}{' '}
              {t('nearbyStops.within25KmTrySearchingForAStopOr')}
            </p>
          )}
          <p className="microcopy">
            {t('nearbyStops.straightLineDistances')}
            {location.accuracy !== undefined &&
              t('nearbyStops.locationAccuracyValue', {
                value1: formatDistance(location.accuracy),
              })}{' '}
            {t('nearbyStops.yourLocationStaysInThisTab')}
          </p>
        </>
      ) : (
        <p className="microcopy">
          {t('nearbyStops.useYourLocationToFindBoardingStopsWithin25')}
        </p>
      )}
    </section>
  );
}
