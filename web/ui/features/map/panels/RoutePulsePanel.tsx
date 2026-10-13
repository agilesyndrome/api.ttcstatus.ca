import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { RoutePulse } from '../RoutePulse';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The live network view, kept separate from Explore so the rail has one job per panel. */
export function RoutePulsePanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const { data, shownRoutes, cars, feed, selectedRoute, selectRoute, panel } = workspace;
  if (!data) return null;
  return (
    <div
      id="panel-route-pulse"
      role="tabpanel"
      aria-label={t('routePulse.routePulse')}
      hidden={panel !== 'route-pulse'}
    >
      <RoutePulse
        routes={shownRoutes}
        cars={cars}
        loaded={Boolean(feed.snapshot)}
        active={feed.active}
        failed={feed.failed}
        selectedRoute={selectedRoute}
        onSelect={(id) => selectRoute(selectedRoute === id ? undefined : id)}
      />
    </div>
  );
}
