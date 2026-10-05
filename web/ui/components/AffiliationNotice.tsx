import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { usePreference } from '../hooks/usePreferences';

export function AffiliationNotice() {
  useLanguage();
  const [dismissed, setDismissed] = usePreference(
    'ttc:affiliation-notice:v1',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  if (dismissed) return null;
  return (
    <aside
      className="affiliation-notice"
      aria-label={t('affiliation.independentSiteNotice')}
    >
      <div>
        <strong>{t('affiliation.anIndependentTransitProject')}</strong>
        <p>
          {t('affiliation.ttcstatusIsNotOfficiallyAffiliatedWithEndorsedByOrOperated')}
        </p>
      </div>
      <button className="action-button" onClick={() => setDismissed(true)}>
        {t('affiliation.gotIt')}
      </button>
    </aside>
  );
}
