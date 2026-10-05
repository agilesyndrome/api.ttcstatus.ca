import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { CSSProperties } from 'react';
import type { Route } from '../../../../shared/map/model';
interface Props {
  routes: Route[];
  selectedRoute?: string;
  onSelect(id?: string): void;
}
export function RouteLegend({ routes, selectedRoute, onSelect }: Props) {
  useLanguage();
  return (
    <section className="route-section">
      <div className="section-heading">
        <h2>{t('routeLegend.exploreARoute')}</h2>
        {selectedRoute && (
          <button className="text-button" onClick={() => onSelect(undefined)}>
            {t('routeLegend.showAll')}
          </button>
        )}
      </div>
      <div className="route-list">
        {routes.map((route) => (
          <button
            key={route.id}
            className="route-button"
            style={{ '--route-color': route.color } as CSSProperties}
            aria-pressed={selectedRoute === route.id}
            disabled={!route.scheduled}
            title={
              !route.scheduled
                ? t('routeLegend.noScheduledStreetcarServiceInThisSnapshot')
                : undefined
            }
            onClick={() => onSelect(selectedRoute === route.id ? undefined : route.id)}
          >
            <span className="route-number">{route.number}</span>
            <span className="route-name">{route.name}</span>
            {(route.overnight || !route.scheduled) && (
              <small className="route-state">
                {route.overnight ? t('viewer.overnight') : t('viewer.railOnly')}
              </small>
            )}
          </button>
        ))}
      </div>
      <p className="legend-note">
        <span className="dashed-swatch" />
        {t('routeLegend.physicalTrackWithoutScheduledStreetcarService')}
      </p>
    </section>
  );
}
