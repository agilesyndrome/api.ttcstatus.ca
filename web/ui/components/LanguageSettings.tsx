import { useId } from 'react';
import {
  getLanguagePreference,
  isLanguagePersistent,
  isLanguagePreference,
  locales,
  setLanguagePreference,
  t,
} from '../i18n';
import { useLanguage } from '../i18n/react';
import { useAccount } from '../features/accounts/auth';

export function LanguageSettings() {
  useLanguage();
  const id = useId();
  const account = useAccount();
  return (
    <section className="language-settings" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>{t('language.browserProfile')}</h1>
      <label htmlFor={id}>{t('language.label')}</label>
      <select
        id={id}
        value={getLanguagePreference()}
        onChange={(event) => {
          if (isLanguagePreference(event.target.value)) {
            setLanguagePreference(event.target.value);
            if (account.userId)
              void account.saveLanguage(event.target.value);
          }
        }}
      >
        <option value="browser">{t('language.browserDefault')}</option>
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code} lang={locale.code}>
            {locale.name}
          </option>
        ))}
      </select>
      <p className="helper">
        {account.userId
          ? t('language.yourLanguagePreferenceIsSavedInYourClerkProfile')
          : t('language.yourLanguagePreferenceIsSavedInThisBrowserNoAccount')}
      </p>
      {!isLanguagePersistent() && (
        <p role="status">
          {t('language.browserStorageIsUnavailableYourLanguageChoiceWillLastFor')}
        </p>
      )}
    </section>
  );
}
