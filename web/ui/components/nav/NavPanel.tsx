import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useAccount } from '../../features/accounts/auth';
import type { SidebarPanel } from '../../commute';
import { useId, type ReactNode } from 'react';
import { navigate } from '../../services/navigation/history';

export type NavCurrent = 'explore' | 'settings';

export interface NavPanelProps {
  /** Single-panel story/usage props. */
  name?: string;
  logo?: ReactNode;
  mode?: 'link' | 'tab';
  href?: string;
  selected?: boolean;
  id?: string;
  controls?: string;
  tabIndex?: number;
  title?: string;
  onClick?(): void;

  /** Menu props. When panel and onPanel are present, NavPanel renders the
   * complete destination menu used by both the shell rail and map drawer. */
  panel?: SidebarPanel;
  onPanel?(next: SidebarPanel): void;
  current?: NavCurrent | boolean;
  collapsed?: boolean;
  panels?: Partial<Record<SidebarPanel, ReactNode>>;
}

type Destination = {
  key: SidebarPanel | 'settings';
  label: () => string;
  href: string;
  logo: ReactNode;
  /** Personal-collection destinations hide entirely until signed in; public
   * ones (Status) stay visible and show their own sign-in gate. */
  signedInOnly?: boolean;
};

export const navLogos: Record<Destination['key'], ReactNode> = {
  explore: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M10.4 5.6 8.9 8.9 5.6 10.4 7.1 7.1z" fill="currentColor" stroke="none" />
    </svg>
  ),
  'route-pulse': (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path
        d="M2 9h2.5l1.5-4 3 7 1.5-4H14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  journal: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3.5 2.75h8.9v10.5H5.2a1.7 1.7 0 0 1-1.7-1.7z" strokeLinejoin="round" />
      <path d="M6.2 2.75v10.5" />
    </svg>
  ),
  badges: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="6" r="3.4" />
      <path d="M5.8 8.9 4.7 13.2 8 11.4l3.3 1.8-1.1-4.3" strokeLinejoin="round" />
    </svg>
  ),
  sla: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2.2 8.6h2.7l1.7-4.3 3 8.6 1.7-4.3h2.5" strokeLinejoin="round" />
    </svg>
  ),
  replay: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.6 5.4 10.8 8 6.6 10.6z" fill="currentColor" stroke="none" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4.75h10M3 11.25h10" strokeLinecap="round" />
      <rect
        x="4.6"
        y="2.75"
        width="2.8"
        height="4"
        rx="1.3"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="8.6"
        y="9.25"
        width="2.8"
        height="4"
        rx="1.3"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  ),
};

const panelItems: readonly Destination[] = [
  {
    key: 'explore',
    label: () => t('navigation.explore'),
    href: '/',
    logo: navLogos.explore,
  },
  {
    key: 'route-pulse',
    label: () => t('routePulse.routePulse'),
    href: '/#view=route-pulse',
    logo: navLogos['route-pulse'],
  },
  {
    key: 'sla',
    label: () => t('navigation.status'),
    href: '/#view=sla',
    logo: navLogos.sla,
  },
  {
    key: 'replay',
    signedInOnly: true,
    label: () => t('navigation.replay'),
    href: '/#view=replay',
    logo: navLogos.replay,
  },
  {
    key: 'journal',
    signedInOnly: true,
    label: () => t('navigation.journal'),
    href: '/#view=journal',
    logo: navLogos.journal,
  },
  {
    key: 'badges',
    signedInOnly: true,
    label: () => t('navigation.badges'),
    href: '/#view=badges',
    logo: navLogos.badges,
  },
];

function titleFor(label: string, collapsed?: boolean) {
  return collapsed ? label : undefined;
}

function renderItem(
  item: Destination,
  props: Omit<
    NavPanelProps,
    'name' | 'logo' | 'panel' | 'onPanel' | 'current' | 'collapsed' | 'panels'
  >,
  current?: boolean,
) {
  return (
    <NavPanel
      key={item.key}
      name={item.label()}
      logo={item.logo}
      href={item.href}
      current={current}
      {...props}
    />
  );
}

interface PanelLinkProps {
  name: string;
  logo: ReactNode;
  mode?: 'link' | 'tab';
  href?: string;
  current?: boolean;
  selected?: boolean;
  id?: string;
  controls?: string;
  tabIndex?: number;
  title?: string;
  onClick?(): void;
}

function PanelLink({
  name,
  logo,
  mode = 'link',
  href,
  current,
  selected,
  id,
  controls,
  tabIndex,
  title,
  onClick,
}: PanelLinkProps) {
  const content = (
    <>
      <span className="main-nav__icon" aria-hidden="true">
        {logo}
      </span>
      <span className="main-nav__text">{name}</span>
    </>
  );

  if (mode === 'tab')
    return (
      <button
        id={id}
        data-nav-item={id?.replace(/^.*?-/, '')}
        role="tab"
        aria-selected={selected}
        aria-controls={controls}
        tabIndex={tabIndex}
        title={title}
        onClick={onClick}
      >
        {content}
      </button>
    );

  return (
    <a
      className="main-nav__link"
      href={href}
      title={title}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (onClick) return onClick();
        if (
          href &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      {content}
    </a>
  );
}

export function NavPanel(props: NavPanelProps) {
  const { name, logo, panel, onPanel, current, collapsed, panels } = props;
  useLanguage();
  const account = useAccount();
  const id = useId();

  // A name and logo make the component useful as a standalone Storybook panel.
  if (name !== undefined && logo !== undefined)
    return (
      <PanelLink
        name={name}
        logo={logo}
        mode={props.mode}
        href={props.href}
        current={props.current === true}
        selected={props.selected}
        id={props.id}
        controls={props.controls}
        tabIndex={props.tabIndex}
        title={props.title}
        onClick={props.onClick}
      />
    );

  const signedIn = Boolean(account.userId);
  const visiblePanels = panelItems.filter((item) => !item.signedInOnly || signedIn);

  if (panel === undefined || onPanel === undefined) {
    return (
      <nav className="main-nav" aria-label={t('navigation.mainMenu')}>
        {visiblePanels.map((item) =>
          renderItem(
            item,
            { title: titleFor(item.label(), collapsed) },
            current === 'explore' && item.key === 'explore',
          ),
        )}
      </nav>
    );
  }

  return (
    <nav className="main-nav" aria-label={t('navigation.mainMenu')}>
      <div
        role="tablist"
        aria-label={t('navigation.mapTools')}
        onKeyDown={(event) => {
          const focused = visiblePanels.findIndex(
            (item) =>
              event.target instanceof HTMLElement &&
              event.target.id === `${id}-${item.key}`,
          );
          const selected = visiblePanels.findIndex((item) => item.key === panel);
          const index = focused < 0 ? Math.max(selected, 0) : focused;
          const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
          const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
          const next = forward
            ? (index + 1) % visiblePanels.length
            : backward
              ? (index + visiblePanels.length - 1) % visiblePanels.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? visiblePanels.length - 1
                  : undefined;
          if (next !== undefined && next >= 0) {
            event.preventDefault();
            onPanel(visiblePanels[next].key as SidebarPanel);
            document.getElementById(`${id}-${visiblePanels[next].key}`)?.focus();
          }
        }}
      >
        {visiblePanels.map((item) => (
          <div className="main-nav__section" key={item.key}>
            {renderItem(item, {
              mode: 'tab',
              id: `${id}-${item.key}`,
              selected: panel === item.key,
              controls: `panel-${item.key}`,
              tabIndex: panel === item.key ? 0 : -1,
              title: titleFor(item.label(), collapsed),
              onClick: () => onPanel(item.key as SidebarPanel),
            })}
          </div>
        ))}
      </div>
      {panels?.[panel] ?? null}
    </nav>
  );
}
