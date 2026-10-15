import { useMediaQuery } from '../../hooks/useMediaQuery';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { type ReactNode } from 'react';
import { usePreference } from '../../hooks/usePreferences';
import { useTheme } from '../../hooks/useTheme';
import { AuthControls } from '../../features/accounts/auth';
import { PageFooter } from '../page/PageFooter';
import { NavPanel, navLogos, type NavCurrent } from './NavPanel';
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

/** The site's single shell-level navigation. It owns the responsive page nav
 * and the wide map rail; NavPanel owns the destination list shared by both. */
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
      {(variant === 'page' || !compact) && (
        <aside className="app-nav" aria-label={t('navigation.mainMenu')}>
          <div className="app-nav__head">
            <a className="brand app-nav__brand" href="/">
              <span className="brand-symbol" aria-hidden="true">
                ↔
              </span>
              <span className="app-nav__lockup">
                <strong>
                  <small className="brand-lead">{t('header.titleLead')}</small>
                  {t('header.titleName')}
                </strong>
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
          <div className="app-nav__quick">
            <a
              className="app-nav__settings"
              href="/settings"
              aria-current={current === 'settings' ? 'page' : undefined}
              title={t('navigation.settings')}
            >
              <span className="main-nav__icon" aria-hidden="true">
                {navLogos.settings}
              </span>
              <span className="app-nav__settings-label">{t('navigation.settings')}</span>
            </a>
            <a
              className="utility-button language-link"
              href="/settings#language"
              aria-label={t('language.settings')}
              title={t('language.settings')}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="7" />
                <path d="M3 10h14M10 3c2 2 3 4.4 3 7s-1 5-3 7c-2-2-3-4.4-3-7s1-5 3-7Z" />
              </svg>
            </a>
            <AuthControls showProfileShortcut={false} />
          </div>
          <PageFooter />
        </aside>
      )}
      <div className="app-main">
        {children}
        {compact && variant === 'page' && <PageFooter />}
      </div>
    </div>
  );
}
