import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { useId } from 'react';
import type { SidebarPanel } from '../commute';
import { useAccount } from '../features/accounts/auth';
const panels = ['explore', 'journal', 'badges'] as const;
export function SidebarTabs({
  value,
  onChange,
}: {
  value: SidebarPanel;
  onChange(value: SidebarPanel): void;
}) {
  useLanguage();
  const account = useAccount();
  const availablePanels = account.userId ? panels : (['explore'] as const);
  const id = useId();
  return (
    <nav className="sidebar-tabs" aria-label={t('navigation.mapTools')}>
      <div
        role="tablist"
        aria-label={t('navigation.mapTools')}
        onKeyDown={(event) => {
          const focused = availablePanels.findIndex(
            (panel) =>
              event.target instanceof HTMLElement && event.target.id === `${id}-${panel}`,
          );
          const index = focused < 0 ? availablePanels.indexOf(value as never) : focused;
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % availablePanels.length
              : event.key === 'ArrowLeft'
                ? (index + availablePanels.length - 1) % availablePanels.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? availablePanels.length - 1
                    : undefined;
          if (next !== undefined) {
            event.preventDefault();
            onChange(panels[next]);
            document.getElementById(`${id}-${panels[next]}`)?.focus();
          }
        }}
      >
        {availablePanels.map((panel) => (
          <button
            key={panel}
            id={`${id}-${panel}`}
            role="tab"
            aria-selected={value === panel}
            aria-controls={`panel-${panel}`}
            tabIndex={value === panel ? 0 : -1}
            onClick={() => onChange(panel)}
          >
            {panel === 'explore'
              ? t('navigation.explore')
              : panel === 'journal'
                ? t('navigation.journal')
                : t('navigation.badges')}
          </button>
        ))}
      </div>
    </nav>
  );
}
