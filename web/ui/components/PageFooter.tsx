import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
export function PageFooter() {
  useLanguage();
  return (
    <footer>
      {t('footer.mapIsSchematicReplacementBusPathsAreExcludedNoLive')}
      <details>
        <summary>{t('footer.mapSources')}</summary>
        <p>
          <a href="https://open.toronto.ca/" target="_blank" rel="noopener noreferrer">
            {t('footer.ttcServiceTorontoGeography')}
          </a>{' '}
          {t('footer.openGovernmentLicenceToronto')}
          <br />
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('footer.openstreetmapContributors')}
          </a>{' '}
          {t('footer.odbl')}
        </p>
      </details>
    </footer>
  );
}
