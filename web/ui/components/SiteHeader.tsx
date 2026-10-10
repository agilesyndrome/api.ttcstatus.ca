import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { AuthControls } from '../features/accounts/auth';
import { MainNav, type MainNavCurrent } from './MainNav';

/** The standalone pages' header (nav-v2): the brand, the one main nav and
 * the account controls in a single row — the same navigation the map
 * workspace carries in its sidebar strip, rendered as a header wherever the
 * sidebar does not exist. Wraps to the nav's own row on small screens. */
export function SiteHeader({ current }: { current?: MainNavCurrent }) {
  useLanguage();
  return (
    <header className="site-header">
      <a className="site-header__brand brand" href="/">
        <span className="brand-symbol" aria-hidden="true">
          ↔
        </span>
        <strong>{t('header.title')}</strong>
      </a>
      <MainNav current={current} />
      <AuthControls />
    </header>
  );
}
