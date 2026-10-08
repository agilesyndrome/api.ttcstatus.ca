import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { siteCommit, siteCommitShort, siteSourceUrl, siteVersion } from '../version';
export function PageFooter() {
  useLanguage();
  const sourceHref = siteCommitShort
    ? `${siteSourceUrl}/tree/${siteCommitShort}`
    : siteSourceUrl;
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
      <p className="site-version">
        {t('footer.siteVersionValue', { value1: siteVersion })} (
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener noreferrer"
          title={siteCommit || undefined}
        >
          {t('footer.source')}
        </a>
        )
      </p>
    </footer>
  );
}
