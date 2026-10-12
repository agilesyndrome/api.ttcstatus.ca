import { useMediaQuery } from '../../hooks/useMediaQuery';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { type ReactNode } from 'react';
import { usePreference } from '../../hooks/usePreferences';
import { useTheme } from '../../hooks/useTheme';
import { AuthControls } from '../../features/accounts/auth';
import { PageFooter } from '../page/PageFooter';
import { NavPanel, type NavCurrent } from './NavPanel';
import type { SidebarPanel } from '../../commute';

export const NAV_RAIL_QUERY = '(max-width: 900px)';

export const useCompactNav = () => useMediaQuery(NAV_RAIL_QUERY);

export interface NavProps {
  variant: 'map' | 'page';
  current?: NavCurrent;
  panel?: SidebarPanel;
  onPanel?(next: SidebarPanel): void;
  panels?: Partial<Record<SidebarPanel, ReactNode>>;
  children: ReactNode;
}

/** The site's single shell-level navigation. It owns the wide rail and the
 * compact standalone-page header; NavPanel owns the destination list shared by
 * both presentations. */
export function Nav({ variant, current, panel, onPanel, panels, children }: NavProps) {
  useLanguage();
  useTheme();
  const compact = useCompactNav();
  const [collapsed, setCollapsed] = usePreference(
    'ttc:nav-rail:v1',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const expandTitle = collapsed ? t('navigation.expandNav') : t('navigation.collapseNav');

  return (
    <div
      className={`app${variant === 'map' ? ' app--map' : ' app--page'}`}
      data-collapsed={collapsed ? '' : undefined}
    >
      {!compact && (
        <aside className="app-nav" aria-label={t('navigation.mainMenu')}>
          <div className="app-nav__head">
            <a className="brand app-nav__brand" href="/">
              <span className="brand-symbol" aria-hidden="true">
                ↔
              </span>
              <span className="app-nav__lockup">
                <strong>{t('header.title')}</strong>
                <small>{t('header.tagline')}</small>
              </span>
            </a>
            <button
              type="button"
              className="app-nav__collapse"
              aria-label={expandTitle}
              title={expandTitle}
              aria-pressed={collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>
          <NavPanel
            current={current}
            panel={panel}
            onPanel={onPanel}
            panels={panels}
            collapsed={collapsed}
          />
          {variant === 'page' && (
            <div className="app-nav__quick">
              <a
                className="account-link language-link"
                href="/settings#language"
                aria-label={t('language.settings')}
                title={t('language.settings')}
              >
                🌐
              </a>
              <AuthControls />
            </div>
          )}
          <PageFooter />
        </aside>
      )}
      <div className="app-main">
        {compact && variant === 'page' && (
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
            <div className="site-header__nav">
              <NavPanel current={current} />
              <a
                className="account-link language-link"
                href="/settings#language"
                aria-label={t('language.settings')}
                title={t('language.settings')}
              >
                🌐
              </a>
            </div>
            <div className="header-actions">
              <AuthControls />
            </div>
          </header>
        )}
        {children}
        {compact && variant === 'page' && <PageFooter />}
      </div>
    </div>
  );
}
