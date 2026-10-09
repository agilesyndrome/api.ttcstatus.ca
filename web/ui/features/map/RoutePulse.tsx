import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { CSSProperties } from 'react';
import type { PlottedVehicle } from '../../../../shared/map/live-status';
import type { Route } from '../../../../shared/map/model';
import { routeActivity } from '../../commute';

interface Props {
  routes: Route[];
  cars: PlottedVehicle[];
  loaded: boolean;
  active: boolean;
  failed: boolean;
  selectedRoute?: string;
  onSelect(id: string): void;
}
export function RoutePulse({
  routes,
  cars,
  loaded,
  active,
  failed,
  selectedRoute,
  onSelect,
}: Props) {
  useLanguage();
  const scheduled = routes.filter((route) => route.scheduled);
  const entries = scheduled.map((route) => ({ route, ...routeActivity(route, cars) }));
  const selected = entries.find((entry) => entry.route.id === selectedRoute);
  // Only cars actively serving one of the shown scheduled routes count toward
  // the route totals; everything else the feed has seen is reported separately.
  const onRoutes = entries.reduce((sum, entry) => sum + entry.reported, 0);
  const offRoute = cars.length - onRoutes;
  const peak = Math.max(1, ...entries.map((entry) => entry.reported));
  return (
    <section className="route-pulse" aria-label={t('routePulse.routeActivity')}>
      <p className="eyebrow">{t('routePulse.theCityInMotion')}</p>
      <div className="section-heading">
        <h2>{t('routePulse.routePulse')}</h2>
        <span className="pulse-total">
          {loaded
            ? t('routePulse.valueTotalOnRoutes', { value1: onRoutes })
            : t('routePulse.waitingForFeed')}
        </span>
      </div>
      <p className="helper">
        {!loaded
          ? t('routePulse.turnOnLiveVehiclesToSeeRouteActivity')
          : !active
            ? t('routePulse.updatesPausedShowingTheLastSnapshot')
            : failed
              ? t('routePulse.refreshUnavailableShowingTheLastSnapshot')
              : t('routePulse.reportedVehiclesByRoute')}
      </p>
      {loaded && (
        <div className="pulse-bars">
          {entries.map((entry) => (
            <button
              key={entry.route.id}
              className="pulse-row"
              style={{ '--route-color': entry.route.color } as CSSProperties}
              aria-pressed={selectedRoute === entry.route.id}
              aria-label={t('routePulse.valueValueValueReportedValueStale', {
                value1: entry.route.number,
                value2: entry.route.name,
                value3: entry.reported,
                value4: entry.stale,
              })}
              onClick={() => onSelect(entry.route.id)}
            >
              <span>{entry.route.number}</span>
              <span className="pulse-track">
                <span style={{ width: `${(entry.reported / peak) * 100}%` }} />
              </span>
              <strong>{entry.reported}</strong>
            </button>
          ))}
          <p className="pulse-row pulse-summary">
            <span>{t('routePulse.notOnRoute')}</span>
            <span className="pulse-track" aria-hidden="true">
              <span style={{ width: `${(offRoute / peak) * 100}%` }} />
            </span>
            <strong>{offRoute}</strong>
          </p>
          <p className="pulse-row pulse-total-row">
            <span>{t('routePulse.carsSeen')}</span>
            <span className="pulse-track" aria-hidden="true" />
            <strong>{cars.length}</strong>
          </p>
        </div>
      )}
      {selected && loaded && (
        <div className="pulse-detail">
          <strong>
            {selected.route.number} {selected.route.name}
          </strong>
          <p>
            {selected.reported} {t('routePulse.reported')} {selected.stale}{' '}
            {t('fleetExplorer.stale2')}
          </p>
          <p>
            {selected.medianSpeed === undefined
              ? t('routePulse.speedNotSuppliedForFreshReports')
              : t('routePulse.valueKmHMedianReportedSpeed', {
                  value1: Math.round(selected.medianSpeed),
                })}
          </p>
        </div>
      )}
      <p className="microcopy">
        {t('routePulse.vehicleCountsDescribeThisFeedNotServiceFrequencyOrDelays')}
      </p>
    </section>
  );
}
