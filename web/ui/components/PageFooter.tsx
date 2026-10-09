import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { siteCommit, siteCommitShort, siteSourceUrl, siteVersion } from '../version';
export function PageFooter() {
  useLanguage();
  // The build-time package version never moves between deploys; the Worker's
  // version_metadata binding gives every Cloudflare deploy a fresh id, so the
  // footer prefers it and falls back to the bundled version (local dev,
  // preview, or if the diagnostics endpoint is unreachable).
  const [deployId, setDeployId] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/version')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const id = body?.deploy?.id;
        if (!cancelled && typeof id === 'string' && id) setDeployId(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const version = deployId || siteVersion;
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
      <p className="site-version" title={deployId || siteCommit || undefined}>
        {t('footer.siteVersionValue', { value1: version })} (
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
