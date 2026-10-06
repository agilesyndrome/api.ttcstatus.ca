import { createRoot } from 'react-dom/client';
import { HomePage } from './pages/HomePage';
import './styles/main.css';
import { AccountProvider } from './features/accounts/auth';
import { ProfilePage, PublicProfilePage } from './pages/ProfilePage';
import { AffiliationNotice } from './components/AffiliationNotice';
import { snakeVersionForPath } from './snake-route';

const path = window.location.pathname.replace(/\/$/, '') || '/';
const publicProfile = /^\/u\/([^/]+)$/.exec(path);
const snakeVersion = snakeVersionForPath(path);
const page =
  path === '/profile' ? (
    <ProfilePage />
  ) : publicProfile ? (
    <PublicProfilePage username={publicProfile[1]} />
  ) : (
    <HomePage initialSnakeVersion={snakeVersion} />
  );
createRoot(document.getElementById('root')!).render(
  <>
    <AccountProvider>{page}</AccountProvider>
    <AffiliationNotice />
  </>,
);
