import {
  getLanguagePreference,
  isLanguagePreference,
  locales,
  setLanguagePreference,
  t,
} from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useAccount } from '../../features/accounts/auth';
import { SegmentedControl } from '../SegmentedControl';

export function LanguageSettings() {
  useLanguage();
  const account = useAccount();
  const choices = [
    { value: 'browser' as const, label: t('language.browserDefault') },
    ...locales.map((locale) => ({
      value: locale.code,
      label: locale.name.split(' (')[0],
    })),
  ];
  return (
    <section className="language-settings" id="language">
      <h1>{t('language.label')}</h1>
      <SegmentedControl
        value={getLanguagePreference()}
        options={choices}
        label={t('language.label')}
        onChange={(value) => {
          if (isLanguagePreference(value)) {
            setLanguagePreference(value);
            if (account.userId) void account.saveLanguage(value);
          }
        }}
      />
    </section>
  );
}
