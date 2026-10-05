import { t, plural } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useId, useMemo, useState } from 'react';
import type { Feature, ViewerData } from '../../../../shared/map/model';
import { formatDistance, type Location } from '../../commute';
import { DEFAULT_STOP_FILTERS, filterStops, type StopFilters } from './stops';
interface Props {
  data: ViewerData;
  savedIds: string[];
  location?: Location;
  onSelect(stop: Feature): void;
}
export function StopBrowser({ data, savedIds, location, onSelect }: Props) {
  useLanguage();
  const id = useId();
  const [filters, setFilters] = useState(DEFAULT_STOP_FILTERS);
  const [page, setPage] = useState(0);
  const matches = useMemo(
    () => filterStops(data, filters, savedIds, location),
    [data, filters, savedIds, location],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 20) - 1));
  const change = (next: Partial<StopFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  };
  return (
    <section className="stop-browser">
      <p className="eyebrow">{t('stopBrowser.everyCornerHasAStory')}</p>
      <h1>{t('stopBrowser.findYourStop')}</h1>
      <p className="helper">
        {t('stopBrowser.browseBoardingStopsStationsAndPhysicalTerminalsInThePublished')}
      </p>
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={id + '-query'}>{t('stopBrowser.searchStops')}</label>
          <input
            id={id + '-query'}
            type="search"
            value={filters.query}
            placeholder={t('stopBrowser.stopStreetOrRouteName')}
            onChange={(event) => change({ query: event.target.value })}
          />
        </div>
        <div className="form-control">
          <label htmlFor={id + '-route'}>{t('stopBrowser.stopRoute')}</label>
          <select
            id={id + '-route'}
            value={filters.route}
            onChange={(event) => change({ route: event.target.value })}
          >
            <option value="">{t('stopBrowser.allRoutes')}</option>
            {data.routes
              .filter((route) => route.scheduled)
              .map((route) => (
                <option key={route.id} value={route.id}>
                  {route.number} {route.name}
                  {route.overnight ? t('stopBrowser.overnightSuffix') : ''}
                </option>
              ))}
          </select>
        </div>
        <div className="form-pair">
          <div className="form-control">
            <label htmlFor={id + '-kind'}>{t('stopBrowser.stopType')}</label>
            <select
              id={id + '-kind'}
              value={filters.kind}
              onChange={(event) =>
                change({ kind: event.target.value as StopFilters['kind'] })
              }
            >
              <option value="boarding">{t('stopBrowser.boardingStops')}</option>
              <option value="terminal">{t('stopBrowser.stationsTerminals')}</option>
              <option value="all">{t('stopBrowser.allMapPlaces')}</option>
            </select>
          </div>
          <div className="form-control">
            <label htmlFor={id + '-sort'}>{t('stopBrowser.sortStops')}</label>
            <select
              id={id + '-sort'}
              value={filters.sort === 'distance' && !location ? 'name' : filters.sort}
              onChange={(event) =>
                change({ sort: event.target.value as StopFilters['sort'] })
              }
            >
              <option value="name">{t('stopBrowser.name')}</option>
              <option value="distance" disabled={!location}>
                {t('fleetExplorer.distanceFromMe')}
              </option>
            </select>
          </div>
        </div>
        <label className="accessible-filter">
          <input
            type="checkbox"
            checked={filters.accessible}
            onChange={(event) => change({ accessible: event.target.checked })}
          />{' '}
          {t('stopBrowser.listedAccessibleBoarding')}
        </label>
        <label className="accessible-filter">
          <input
            type="checkbox"
            checked={filters.saved}
            onChange={(event) => change({ saved: event.target.checked })}
          />{' '}
          {t('stopBrowser.savedStopsOnly')}
        </label>
      </div>
      <p className="fleet-count" role="status">
        {plural('counts.placesFound', matches.length)}
      </p>
      <ul className="compact-list">
        {matches
          .slice(currentPage * 20, currentPage * 20 + 20)
          .map(({ stop, metres }) => (
            <li key={stop.id}>
              <button className="list-choice" onClick={() => onSelect(stop)}>
                <strong>
                  {savedIds.includes(stop.id) && (
                    <span aria-label={t('routeGuide.saved')}>★ </span>
                  )}
                  {stop.name}
                  {metres !== undefined && (
                    <span className="distance">{formatDistance(metres)}</span>
                  )}
                </strong>
                <small>
                  {stop.boardingPoints
                    ? stop.routeIds
                        .map(
                          (routeId) =>
                            data.routes.find((route) => route.id === routeId)?.number ??
                            routeId,
                        )
                        .join(' · ') +
                      ' · ' +
                      stop.boardingPoints +
                      t('stopBrowser.boardingPoints')
                    : t('stopBrowser.physicalTerminalNoScheduledBoardingRecords')}
                </small>
                {stop.accessible === true && (
                  <small>{t('stopBrowser.accessibleBoardingListed')}</small>
                )}
              </button>
            </li>
          ))}
      </ul>
      {!matches.length && (
        <p className="helper">
          {t('stopBrowser.noPlacesMatchTheseFiltersTryAnotherStreetOrBroaden')}
        </p>
      )}
      {matches.length > 20 && (
        <div className="fleet-pagination">
          <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            {t('stopBrowser.previousStops')}
          </button>
          <span>
            {t('fleetExplorer.page')} {currentPage + 1} {t('fleetExplorer.of')}{' '}
            {Math.ceil(matches.length / 20)}
          </span>
          <button
            disabled={(currentPage + 1) * 20 >= matches.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('stopBrowser.nextStops')}
          </button>
        </div>
      )}
      <button
        className="action-button"
        onClick={() => {
          setFilters(DEFAULT_STOP_FILTERS);
          setPage(0);
        }}
      >
        {t('stopBrowser.resetStopFilters')}
      </button>
      <p className="microcopy">
        {t('stopBrowser.accessibilityComesFromTheStaticFeedAndMayApplyTo')}
      </p>
    </section>
  );
}
