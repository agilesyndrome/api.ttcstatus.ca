import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { useId } from 'react';
import { useAccount } from '../features/accounts/auth';
import type { SidebarPanel } from '../commute';

/** The one primary navigation (nav-v2): the same five items on every page —
 * Explore, Journal and Badges (the map workspace's sidebar panels), then SLA
 * and Settings. Where the sidebar lives (the map workspace) the panels are
 * tabs that switch in place, with SLA and Settings beside them as links;
 * everywhere else (/sla, /profile, /u/*) the whole strip is links carrying
 * the map's own `#view=` hashes — so desktop and mobile render one coherent
 * menu with the same order and labels.
 *
 * Journal and Badges stay behind sign-in exactly as before: a signed-out
 * visitor keeps the public items (Explore, SLA, Settings) and meets the
 * account gate the moment they sign in. */
const panels = ['explore', 'journal', 'badges'] as const;

const panelLabel: Record<SidebarPanel, () => string> = {
  explore: () => t('navigation.explore'),
  journal: () => t('navigation.journal'),
  badges: () => t('navigation.badges'),
};

/** On standalone pages the panels keep working as links — the map's own
 * shared-view hashes (`readMapLink`) rehydrate the panel on arrival. */
const panelHref: Record<SidebarPanel, string> = {
  explore: '/',
  journal: '/#view=journal',
  badges: '/#view=badges',
};

export type MainNavCurrent = 'explore' | 'sla' | 'settings';

type TabMode = {
  /** The sidebar's live panel. */
  panel: SidebarPanel;
  onPanel(next: SidebarPanel): void;
  current?: undefined;
};
type LinkMode = {
  panel?: undefined;
  onPanel?: undefined;
  /** The page's own surface, marked `aria-current` in link mode. */
  current?: MainNavCurrent;
};

/** The page destinations — identical in both modes, so the strip reads the
 * same wherever it renders. */
function pageLinks() {
  return (
    <>
      <a className="main-nav__link" href="/sla">
        {t('navigation.sla')}
      </a>
      <a className="main-nav__link" href="/profile">
        {t('navigation.settings')}
      </a>
    </>
  );
}

export function MainNav({ panel, onPanel, current }: TabMode | LinkMode) {
  useLanguage();
  const account = useAccount();
  const id = useId();
  const signedIn = Boolean(account.userId);
  // Personal panels appear only for signed-in accounts — the same gate the
  // sidebar has always had.
  const visiblePanels = signedIn ? panels : (['explore'] as const);

  if (panel === undefined || onPanel === undefined) {
    // Standalone pages: one strip of links, the page's own surface marked.
    return (
      <nav className="main-nav" aria-label={t('navigation.mainMenu')}>
        {visiblePanels.map((item) => (
          <a
            key={item}
            className="main-nav__link"
            href={panelHref[item]}
            aria-current={
              current === 'explore' && item === 'explore' ? 'page' : undefined
            }
          >
            {panelLabel[item]()}
          </a>
        ))}
        <a
          className="main-nav__link"
          href="/sla"
          aria-current={current === 'sla' ? 'page' : undefined}
        >
          {t('navigation.sla')}
        </a>
        <a
          className="main-nav__link"
          href="/profile"
          aria-current={current === 'settings' ? 'page' : undefined}
        >
          {t('navigation.settings')}
        </a>
      </nav>
    );
  }

  // The map workspace: the panels are tabs (arrow keys included) and the
  // page destinations sit beside them in the same strip.
  return (
    <nav className="main-nav" aria-label={t('navigation.mainMenu')}>
      <div
        role="tablist"
        aria-label={t('navigation.mapTools')}
        onKeyDown={(event) => {
          const focused = visiblePanels.findIndex(
            (item) =>
              event.target instanceof HTMLElement && event.target.id === `${id}-${item}`,
          );
          const index = focused < 0 ? visiblePanels.indexOf(panel as never) : focused;
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % visiblePanels.length
              : event.key === 'ArrowLeft'
                ? (index + visiblePanels.length - 1) % visiblePanels.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? visiblePanels.length - 1
                    : undefined;
          if (next !== undefined && next >= 0) {
            event.preventDefault();
            onPanel(visiblePanels[next]);
            document.getElementById(`${id}-${visiblePanels[next]}`)?.focus();
          }
        }}
      >
        {visiblePanels.map((item) => (
          <button
            key={item}
            id={`${id}-${item}`}
            role="tab"
            aria-selected={panel === item}
            aria-controls={`panel-${item}`}
            tabIndex={panel === item ? 0 : -1}
            onClick={() => onPanel(item)}
          >
            {panelLabel[item]()}
          </button>
        ))}
      </div>
      <div className="main-nav__pages">{pageLinks()}</div>
    </nav>
  );
}
