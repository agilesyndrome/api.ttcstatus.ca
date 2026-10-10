import { t } from '../i18n';
import { useLanguage } from '../i18n/react';

/** The one day/night control, rendered by the map's top bar and the
 * standalone pages' header alike — identical pill, labels and aria
 * wherever a page carries it. The theme state itself belongs to the
 * caller (the map workspace's own hook instance), so the two surfaces
 * never double-mount the preference. */
export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle(): void }) {
  useLanguage();
  return (
    <button
      className="theme-toggle"
      aria-label={
        dark ? t('workspace.switchToDayTheme') : t('workspace.switchToNightTheme')
      }
      onClick={onToggle}
    >
      {dark ? t('workspace.day') : t('workspace.night')}
    </button>
  );
}
