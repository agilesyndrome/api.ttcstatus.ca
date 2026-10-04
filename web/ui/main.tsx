import { createRoot } from 'react-dom/client';
import { HomePage } from './pages/HomePage';
import './styles/main.css';
import { AccountProvider } from './features/accounts/auth';
import { ProfilePage, PublicProfilePage } from './pages/ProfilePage';

const path = window.location.pathname.replace(/\/$/, '') || '/';
const publicProfile = /^\/u\/([^/]+)$/.exec(path);
const page =
  path === '/profile' ? (
    <ProfilePage />
  ) : publicProfile ? (
    <PublicProfilePage username={publicProfile[1]} />
  ) : (
    <HomePage />
  );
createRoot(document.getElementById('root')!).render(
  <AccountProvider>{page}</AccountProvider>,
);
