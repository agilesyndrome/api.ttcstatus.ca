import { useViewportHeight } from './hooks/useViewportHeight';
import { lazy, Suspense, useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { useRoute } from './services/navigation/react';
import { navigate } from './services/navigation/history';
import { ScreenActiveContext } from './services/platform/react';
import { snakeVersionForPath } from './snake-route';
import { t } from './i18n';
import { ColourModeProvider } from './hooks/useColourMode';

const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const PublicProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({ default: module.PublicProfilePage })),
);

/** The former /sla page now lives in the workspace as the Status panel; old
 * links land there directly (replaced, so Back skips the redirect hop). */
function SlaRedirect() {
  useEffect(() => {
    navigate('/#view=sla', true);
  }, []);
  return <p role="status">{t('workspace.loadingTheStreetcarNetwork')}</p>;
}

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
      <SlaRedirect />
    ) : publicProfile ? (
      <PublicProfilePage key={publicProfile[1]} username={publicProfile[1]} />
    ) : null;
  return (
    <ColourModeProvider>
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
    </ColourModeProvider>
  );
}
