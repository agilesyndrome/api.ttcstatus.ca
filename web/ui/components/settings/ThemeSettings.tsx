import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useTheme, type Theme } from '../../hooks/useTheme';
import { SegmentedControl } from '../SegmentedControl';

/** The one day/night control (nav-v3): it lives in Settings beside the
 * language preference — a browser-local choice, no account required. The
 * map's `N` keyboard shortcut still flips it from anywhere; this is the
 * settings surface for the same preference. */
export function ThemeSettings() {
  useLanguage();
  const { theme, setTheme } = useTheme();
  const choices: { value: Theme; label: string }[] = [
    { value: 'light', label: t('workspace.day') },
    { value: 'dark', label: t('workspace.night') },
    { value: 'system', label: t('theme.followSystem') },
  ];
  return (
    <section className="theme-settings" id="appearance">
      <h1>{t('theme.appearance')}</h1>
      <SegmentedControl
        value={theme}
        options={choices}
        label={t('theme.appearance')}
        onChange={(value) => setTheme(value)}
      />
    </section>
  );
}
