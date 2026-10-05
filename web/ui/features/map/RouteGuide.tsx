import { t, plural } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { Feature, Route, ViewerData } from '../../../../shared/map/model';
import { routeItineraries } from './route-guide';

interface Props {
  data: ViewerData;
  route: Route;
  savedIds: string[];
  onSelect(feature: Feature): void;
  onClose(): void;
}

export function RouteGuide({
  data,
  route,
  savedIds,
  onSelect,
  onClose,
}: Props) {
  useLanguage();
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
      aria-label={t('routeGuide.routeStopGuide')}
      style={{ '--route-color': route.color } as CSSProperties}
    >
      <p className="eyebrow">{t('routeGuide.oneRouteStopByStop')}</p>
      <div className="details-heading">
        <h1>
          <span className="guide-route-number">{route.number}</span> {route.name}
        </h1>
        <button
          className="close-details"
          aria-label={t('routeGuide.closeRouteGuide')}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {route.overnight && <p className="tip">{t('routeGuide.overnightRoute')}</p>}
      {itinerary ? (
        <>
          <div className="tool-form">
            <div className="form-control">
              <label htmlFor={`${id}-pattern`}>
                {t('routeGuide.scheduledDirectionVariant')}
              </label>
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
                    {index + 1}. {item.headsign || t('routeGuide.destinationNotSupplied')}{' '}
                    · {item.boardingPoints} {t('routeGuide.boardingPoints')}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor={`${id}-query`}>{t('routeGuide.findOnThisRoute')}</label>
              <input
                id={`${id}-query`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('routeGuide.stationOrStreetName')}
              />
            </div>
          </div>
          <p className="helper">
            {t('routeGuide.mappedStops')} {first?.name ?? t('routeGuide.none')} →{' '}
            {last?.name ?? t('routeGuide.none')}
          </p>
          <p className="microcopy">
            {t('routeGuide.scheduledStopOrderNotALiveServiceGuaranteeVariantsMay')}
          </p>
          {itinerary.unmapped > 0 && (
            <p className="tip">{plural('counts.unmappedBoarding', itinerary.unmapped)}</p>
          )}
          <p className="fleet-count" role="status">
            {stops.length} {t('fleetExplorer.of')} {itinerary.stops.length}{' '}
            {t('routeGuide.mappedStops2')}
          </p>
          <ol className="route-stop-list">
            {stops.map(({ feature, sequence }) => (
              <li key={sequence}>
                <span
                  className="guide-sequence"
                  aria-label={t('routeGuide.boardingSequenceValue', { value1: sequence })}
                >
                  {sequence}
                </span>
                <button className="list-choice" onClick={() => onSelect(feature)}>
                  <strong>
                    {savedIds.includes(feature.id) && (
                      <span aria-label={t('routeGuide.saved')}>★ </span>
                    )}
                    {feature.name}
                  </strong>
                  <small>
                    {feature.accessible ? t('routeGuide.accessibleBoardingListed') : ''}
                    {t('routeGuide.viewStopDetails')}
                  </small>
                </button>
              </li>
            ))}
          </ol>
          {!stops.length && (
            <p className="helper">
              {query
                ? t('routeGuide.noStopsMatchThisSearchTryAnotherStreetOrStation')
                : t('routeGuide.noBoardingPointsInThisVariantAreMapped')}
            </p>
          )}
        </>
      ) : (
        <p className="tip">
          {t('routeGuide.orderedStopInformationIsUnavailableForThisRouteInThe')}
        </p>
      )}
    </section>
  );
}
