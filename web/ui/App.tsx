import { useViewportHeight } from './hooks/useViewportHeight';
import { lazy, Suspense, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { useRoute } from './services/navigation/react';
import { ScreenActiveContext } from './services/platform/react';
import { snakeVersionForPath } from './snake-route';
import { t } from './i18n';

const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const PublicProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({ default: module.PublicProfilePage })),
);
const SlaPage = lazy(() =>
  import('./pages/SlaPage').then((module) => ({ default: module.SlaPage })),
);

export function App() {
  useViewportHeight();
  const route = useRoute();
  const path = new URL(route, 'https://ttcstatus.ca').pathname.replace(/\/$/, '') || '/';
  const publicProfile = /^\/u\/([^/]+)$/.exec(path);
  const snakeVersion = snakeVersionForPath(path);
  const home = !['/settings', '/profile', '/sla'].includes(path) && !publicProfile;
  const [visitedHome, setVisitedHome] = useState(home);
  if (home && !visitedHome) setVisitedHome(true);
  const page =
    path === '/settings' ? (
      <SettingsPage />
    ) : path === '/profile' ? (
      <ProfilePage />
    ) : path === '/sla' ? (
      <SlaPage />
    ) : publicProfile ? (
      <PublicProfilePage key={publicProfile[1]} username={publicProfile[1]} />
    ) : null;
  return (
    <>
      {(visitedHome || home) && (
        <ScreenActiveContext.Provider value={home}>
          <div className="route-screen" hidden={!home}>
            <HomePage initialSnakeVersion={snakeVersion} />
          </div>
        </ScreenActiveContext.Provider>
      )}
      {!home && (
        <div className="route-screen route-page">
          <Suspense
            fallback={<p role="status">{t('workspace.loadingTheStreetcarNetwork')}</p>}
          >
            {page}
          </Suspense>
        </div>
      )}
    </>
  );
}
