import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/main.css';
import { AccountProvider } from './features/accounts/auth';
import { AffiliationNotice } from './components/AffiliationNotice';
import { initializePlatform, platform } from './services/platform';
import { registerOfflineShell } from './services/platform/browser/offline-shell';
import { startNavigation } from './services/navigation/history';
import { hydrateLanguage } from './i18n';

await initializePlatform();
await hydrateLanguage();
startNavigation();
if (!platform().native) registerOfflineShell();
createRoot(document.getElementById('root')!).render(
  <AccountProvider>
    <>
      <App />
      <AffiliationNotice />
    </>
  </AccountProvider>,
);
