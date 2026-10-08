import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useState } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import { formatDistance, nearbyStops, type Location } from '../../commute';

interface Props {
  data: ViewerData;
  location?: Location;
  onClear(): void;
  onSelect(feature: Feature): void;
}
export function NearbyStops({ data, location, onClear, onSelect }: Props) {
  useLanguage();
  const [accessible, setAccessible] = useState(false);
  const stops = location ? nearbyStops(data, location, accessible) : [];
  return (
    <section className="nearby-stops" aria-label={t('nearbyStops.nearbyStops')}>
      <div className="section-heading">
        <h2>{t('nearbyStops.nearMe')}</h2>
        {location && (
          <button className="text-button" onClick={onClear}>
            {t('nearbyStops.clearLocation')}
          </button>
        )}
      </div>
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
