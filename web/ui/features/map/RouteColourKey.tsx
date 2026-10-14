import type { Route } from '../../../../shared/map/model';
import type { CSSProperties } from 'react';
import { t } from '../../i18n';

export function RouteColourKey({ routes }: { routes: Route[] }) {
  return (
    <section className="route-colour-key" aria-label={t('routeLegend.routeColours')}>
      <strong>{t('routeLegend.routeColours')}</strong>
      <div>
        {routes.map((route) => (
          <span key={route.id} style={{ '--route-color': route.color } as CSSProperties}>
            <i aria-hidden="true" /> {route.number}
          </span>
        ))}
      </div>
    </section>
  );
}
