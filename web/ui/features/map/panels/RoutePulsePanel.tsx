import { t } from '../../../i18n';
import { useLanguage } from '../../../i18n/react';
import { RoutePulse } from '../RoutePulse';
import type { HomeWorkspaceState } from '../useHomeWorkspace';

/** The live network view in the main pane. Selecting a route opens it on the map. */
export function RoutePulsePanel({ workspace }: { workspace: HomeWorkspaceState }) {
  useLanguage();
  const { data, shownRoutes, cars, feed, selectedRoute, selectRoute, setPanel, panel } =
    workspace;
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
        onSelect={(id) => {
          selectRoute(id);
          setPanel('explore');
        }}
      />
    </div>
  );
}
