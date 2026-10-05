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
  const entries = routes
    .filter((route) => route.scheduled)
    .map((route) => ({ route, ...routeActivity(route, cars) }));
  const selected = entries.find((entry) => entry.route.id === selectedRoute);
  const fresh = cars.filter((car) => !car.stale).length;
  const peak = Math.max(1, ...entries.map((entry) => entry.fresh));
  return (
    <section className="route-pulse" aria-label={t('routePulse.routeActivity')}>
      <p className="eyebrow">{t('routePulse.theCityInMotion')}</p>
      <div className="section-heading">
        <h2>{t('routePulse.routePulse')}</h2>
        <span className="pulse-total">
          {loaded
            ? t('routePulse.valueFreshReports', { value1: fresh })
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
              : t('routePulse.freshVehicleReportsByRoute')}
      </p>
      {loaded && (
        <div className="pulse-bars">
          {entries.map((entry) => (
            <button
              key={entry.route.id}
              className="pulse-row"
              style={{ '--route-color': entry.route.color } as CSSProperties}
              aria-pressed={selectedRoute === entry.route.id}
              aria-label={t('routePulse.valueValueValueFreshValueStaleVehicleReports', {
                value1: entry.route.number,
                value2: entry.route.name,
                value3: entry.fresh,
                value4: entry.stale,
              })}
              onClick={() => onSelect(entry.route.id)}
            >
              <span>{entry.route.number}</span>
              <span className="pulse-track">
                <span style={{ width: `${(entry.fresh / peak) * 100}%` }} />
              </span>
              <strong>{entry.fresh}</strong>
            </button>
          ))}
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
