import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { savedStopStatus } from './saved-stop-status';
import { BookmarkBackup } from './BookmarkBackup';

interface Props {
  data: ViewerData;
  ids: string[];
  persistent: boolean;
  signedIn?: boolean;
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
  signedIn = false,
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
  useLanguage();
  const stops = ids.map((id) => ({
    id,
    feature: data.features.find((feature) => feature.id === id),
  }));
  return (
    <section className="my-stops" aria-label={t('myStops.savedStops')}>
      <div className="section-heading">
        <h2>{t('myStops.myStops')}</h2>
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
                <strong>{feature?.name ?? t('myStops.stopNoLongerInThisMap')}</strong>
                <small>
                  {feature
                    ? feature.routeIds
                        .map((id) => data.routes.find((route) => route.id === id)?.number)
                        .filter(Boolean)
                        .join(' · ') || t('header.physicalTerminal')
                    : t('myStops.removeThisBookmarkAndChooseACurrentStop')}
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
                aria-label={t('myStops.removeValueFromSavedStops', {
                  value1: feature?.name ?? t('myStops.unavailableStop'),
                })}
                onClick={() => onRemove(id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="helper">{t('myStops.yourEverydayStopsOneTapAwaySelectAStopAnd')}</p>
      )}
      {stops.length > 0 && (
        <p className="microcopy">
          {enabled &&
            (failed
              ? t('myStops.refreshUnavailable')
              : !active
                ? t('myStops.updatesPaused')
                : '')}
          {t('myStops.trainTimesArePredictionsStreetcarDistancesAreProximityNotArrival')}
        </p>
      )}
      {onRestore && <BookmarkBackup data={data} ids={ids} onRestore={onRestore} />}
      <p className="microcopy">
        {signedIn
          ? t('myStops.savedToYourAccount')
          : persistent
            ? t('myStops.savedOnThisBrowser')
            : t('savedComparisons.browserStorageUnavailableSavedForThisVisit')}
      </p>
    </section>
  );
}
