import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useId } from 'react';
import { useTheme, type Theme } from '../../hooks/useTheme';

/** The one day/night control (nav-v3): it lives in Settings beside the
 * language preference — a browser-local choice, no account required. The
 * map's `N` keyboard shortcut still flips it from anywhere; this is the
 * settings surface for the same preference. */
export function ThemeSettings() {
  useLanguage();
  const { theme, setTheme } = useTheme();
  const id = useId();
  const choices: { value: Theme; label: string }[] = [
    { value: 'light', label: t('workspace.day') },
    { value: 'dark', label: t('workspace.night') },
    { value: 'system', label: t('theme.followSystem') },
  ];
  return (
    <section className="theme-settings" id="appearance" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>{t('theme.appearance')}</h1>
      <div className="theme-choices" role="group" aria-label={t('theme.appearance')}>
        {choices.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="helper">{t('theme.helper')}</p>
    </section>
  );
}
