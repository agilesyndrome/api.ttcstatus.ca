import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { siteCommit, siteCommitShort, siteSourceUrl, siteVersion } from '../../version';

/** open-source credit and the running version,
 * rendered at the foot of the rail (wide screens), the sidebar overlay
 * (phones) and the standalone pages alike. */
export function PageFooter() {
  useLanguage();
  const sourceHref = siteCommitShort
    ? `${siteSourceUrl}/tree/${siteCommitShort}`
    : siteSourceUrl;
  return (
    <footer className="site-footer">
      <p className="site-credit">
        {t('footer.anOpenSourceProjectByDrewEasley')} ·{' '}
        <a
          href="https://www.cloudflare.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Hosted by Cloudflare
        </a>
      </p>
      <p className="site-version" title={siteCommit || undefined}>
        {siteCommitShort ? (
          <a href={sourceHref} target="_blank" rel="noopener noreferrer">
            {siteCommitShort}
          </a>
        ) : (
          siteVersion
        )}
      </p>
    </footer>
  );
}
