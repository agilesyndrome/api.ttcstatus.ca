import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { useTheme } from '../hooks/useTheme';
import { AuthControls } from '../features/accounts/auth';
import { MainNav, type MainNavCurrent } from './MainNav';
import { ThemeToggle } from './ThemeToggle';

/** The standalone pages' header (nav-v2): the same chrome the map's top bar
 * carries, wherever the sidebar does not exist — the full brand lockup
 * (symbol, title, tagline), the one main nav, and the same quick controls
 * (language, day/night, account) in the same order as the map's header
 * actions. Mounting the theme hook here is what applies a visitor's stored
 * day/night preference on these pages — exactly as the map workspace does
 * for its own — and the map-only keyboard-shortcuts control stays home.
 * Wraps the nav onto its own row on small screens. */
export function SiteHeader({ current }: { current?: MainNavCurrent }) {
  useLanguage();
  const theme = useTheme();
  return (
    <header className="site-header">
      <a className="site-header__brand brand" href="/">
        <span className="brand-symbol" aria-hidden="true">
          ↔
        </span>
        <span>
          <strong>{t('header.title')}</strong>
          <small>{t('header.tagline')}</small>
        </span>
      </a>
      {/* The nav and the day/night control share one row: centered together
       * on wide screens, and on phones a full-width strip with the toggle
       * at its right edge — one deterministic row, never a wrap race. */}
      <div className="site-header__nav">
        <MainNav current={current} />
        <ThemeToggle dark={theme.dark} onToggle={theme.toggle} />
      </div>
      <div className="header-actions">
        {/* The profile page IS the language destination; there the quick
         * link would only point at itself, so it stays a map/sla-cluster
         * affordance. */}
        {current !== 'settings' && (
          <a
            className="account-link language-link"
            href="/profile"
            aria-label={t('language.settings')}
            title={t('language.settings')}
          >
            🌐
          </a>
        )}
        <AuthControls />
      </div>
    </header>
  );
}
