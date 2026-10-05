import { t, getLocale } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useId, useMemo, useState } from 'react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { ViewerData } from '../../../../shared/map/model';
import type { VehicleSnapshot } from '../../../../shared/live/vehicles';
import { formatDistance, type Location } from '../../commute';
import { DEFAULT_FLEET_FILTERS, filterFleet, fleetCsv, type FleetFilters } from './fleet';

interface Props {
  data: ViewerData;
  cars: PlottedVehicle[];
  snapshot?: VehicleSnapshot;
  active: boolean;
  failed: boolean;
  location?: Location;
  onSelect(car: PlottedVehicle): void;
  onEnableLive(): void;
}
const PAGE_SIZE = 20;
export function FleetExplorer({
  data,
  cars,
  snapshot,
  active,
  failed,
  location,
  onSelect,
  onEnableLive,
}: Props) {
  useLanguage();
  const id = useId();
  const [filters, setFilters] = useState<FleetFilters>(DEFAULT_FLEET_FILTERS);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const sort = filters.sort === 'distance' && !location ? 'number' : filters.sort;
  const results = useMemo(
    () => filterFleet(cars, data.routes, { ...filters, sort }, location),
    [cars, data.routes, filters, sort, location],
  );
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const assignments = [
    ...new Set(cars.flatMap((car) => (car.vehicle.routeId ? [car.vehicle.routeId] : []))),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  function update(next: Partial<FleetFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
    setMessage('');
  }
  function download() {
    if (!snapshot) return;
    const csv = fleetCsv(
      results.map((result) => result.car),
      data.routes,
      snapshot,
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'toronto-streetcar-snapshot.csv';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      t('fleetExplorer.downloadedValueVehicleReports', { value1: results.length }),
    );
  }
  return (
    <section className="fleet-explorer" aria-label={t('fleetExplorer.fleetExplorer')}>
      <p className="eyebrow">{t('fleetExplorer.meetTheFleet')}</p>
      <h1>{t('fleetExplorer.trainStreetcarSpotting')}</h1>
      <p className="helper">
        {t('fleetExplorer.everyCarInTheSharedLiveSnapshotIncludingOvernightAssignments')}
      </p>
      {!active && (
        <>
          <p className="tip">
            {t('fleetExplorer.updatesArePaused')}{' '}
            {snapshot
              ? t('fleetExplorer.showingTheLastSnapshot')
              : t('fleetExplorer.enableLiveStreetcarsToLoadTheFleet')}
          </p>
          <button className="action-button" onClick={onEnableLive}>
            {t('fleetExplorer.enableLiveUpdates')}
          </button>
        </>
      )}
      {failed && (
        <p role="status" className="helper">
          {snapshot
            ? t('fleetExplorer.refreshUnavailableKeepingTheLastSnapshot')
            : t('fleetExplorer.liveVehiclePositionsAreUnavailableTheFeedWillRetry')}
        </p>
      )}
      <div className="tool-form">
        <div className="form-control">
          <label htmlFor={`${id}-query`}>{t('fleetExplorer.findInFleet')}</label>
          <input
            id={`${id}-query`}
            type="search"
            value={filters.query}
            placeholder={t('fleetExplorer.carNumberOrRouteName')}
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>
        <div className="form-control">
          <label htmlFor={`${id}-route`}>{t('fleetExplorer.routeAssignment')}</label>
          <select
            id={`${id}-route`}
            value={filters.route}
            onChange={(event) => update({ route: event.target.value })}
          >
            <option value="">{t('fleetExplorer.allAssignments')}</option>
            <option value="unassigned">{t('header.routeNotSupplied')}</option>
            {assignments.map((id) => {
              const route = data.routes.find((route) => route.id === id);
              return (
                <option key={id} value={`route:${id}`}>
                  {route
                    ? `${route.number} ${route.name}`
                    : t('fleetExplorer.reportedRouteValue', { value1: id })}
                </option>
              );
            })}
          </select>
        </div>
        <div className="form-pair">
          <div className="form-control">
            <label htmlFor={`${id}-status`}>{t('fleetExplorer.positionStatus')}</label>
            <select
              id={`${id}-status`}
              value={filters.status}
              onChange={(event) =>
                update({ status: event.target.value as FleetFilters['status'] })
              }
            >
              <option value="all">{t('fleetExplorer.allReports')}</option>
              <option value="fresh">{t('fleetExplorer.freshOnly')}</option>
              <option value="stale">{t('fleetExplorer.staleOnly')}</option>
              <option value="off-track">{t('fleetExplorer.offMappedTrack')}</option>
            </select>
          </div>
          <div className="form-control">
            <label htmlFor={`${id}-sort`}>{t('fleetExplorer.sortCars')}</label>
            <select
              id={`${id}-sort`}
              value={sort}
              onChange={(event) =>
                update({ sort: event.target.value as FleetFilters['sort'] })
              }
            >
              <option value="number">{t('fleetExplorer.carNumber')}</option>
              <option value="speed">{t('viewer.reportedSpeed')}</option>
              <option value="distance" disabled={!location}>
                {t('fleetExplorer.distanceFromMe')}
              </option>
            </select>
          </div>
        </div>
      </div>
      <div className="section-heading">
        <p role="status" className="fleet-count">
          {snapshot
            ? t('fleetExplorer.valueOfValueReportedCars', {
                value1: results.length,
                value2: cars.length,
              })
            : active && !failed
              ? t('fleetExplorer.loadingTheFleet')
              : t('fleetExplorer.noSnapshotLoaded')}
        </p>
        <button
          className="text-button"
          onClick={() => {
            setFilters(DEFAULT_FLEET_FILTERS);
            setPage(0);
            setMessage('');
          }}
        >
          {t('fleetExplorer.resetFilters')}
        </button>
      </div>
      <ul className="compact-list fleet-list">
        {results
          .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
          .map(({ car, metres }) => {
            const route = data.routes.find((route) => route.id === car.vehicle.routeId);
            return (
              <li key={car.vehicle.id}>
                <button className="list-choice" onClick={() => onSelect(car)}>
                  <strong>
                    {t('viewer.car')} {car.vehicle.label}
                    <span className={`report-tag ${car.stale ? 'stale' : ''}`}>
                      {car.stale ? t('fleetExplorer.stale') : t('fleetExplorer.fresh')}
                    </span>
                  </strong>
                  <small>
                    {route
                      ? `${route.number} ${route.name}`
                      : car.vehicle.routeId
                        ? t('fleetExplorer.reportedRouteValue', {
                            value1: car.vehicle.routeId,
                          })
                        : t('header.routeNotSupplied')}
                    {!car.match && t('fleetExplorer.offMappedTrack2')}
                  </small>
                  <small>
                    {car.vehicle.speedMetresPerSecond !== undefined
                      ? t('fleetExplorer.valueKmHReported', {
                          value1: Math.round(car.vehicle.speedMetresPerSecond * 3.6),
                        })
                      : t('fleetExplorer.speedNotSupplied')}
                    {metres !== undefined &&
                      t('fleetExplorer.valueFromYou', { value1: formatDistance(metres) })}
                  </small>
                </button>
              </li>
            );
          })}
      </ul>
      {snapshot && !results.length && (
        <p className="tip">
          {t('fleetExplorer.noCarsMatchTheseFiltersTryAnotherAssignmentOrPosition')}
        </p>
      )}
      {pages > 1 && (
        <nav className="fleet-pagination" aria-label={t('fleetExplorer.fleetPages')}>
          <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            {t('fleetExplorer.previous')}
          </button>
          <span>
            {t('fleetExplorer.page')} {currentPage + 1} {t('fleetExplorer.of')} {pages}
          </span>
          <button
            disabled={currentPage + 1 === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('fleetExplorer.next')}
          </button>
        </nav>
      )}
      <button
        className="action-button export-fleet"
        disabled={!snapshot || !results.length}
        onClick={download}
      >
        {t('fleetExplorer.downloadFilteredSnapshotCsv')}
      </button>
      <p role="status" className="microcopy">
        {t(message)}
      </p>
      {snapshot && (
        <p className="microcopy">
          {t('fleetExplorer.snapshotFetched')}{' '}
          {new Date(snapshot.fetchedAt).toLocaleTimeString(getLocale(), {
            timeZone: 'America/Toronto',
          })}
          {t('fleetExplorer.csvIncludesReportTimesAndFreshnessItContainsNoPersonal')}
        </p>
      )}
    </section>
  );
}
