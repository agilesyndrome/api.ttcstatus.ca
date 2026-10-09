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
      <p className="site-version" title={siteCommit || undefined}>
        {siteCommitShort ? (
          <a href={sourceHref} target="_blank" rel="noopener noreferrer">
            {siteCommitShort}
          </a>
        ) : (
          siteVersion
        )}
      </p>
      <p className="site-credit">{t('footer.anOpenSourceProjectByDrewEasley')}</p>
    </footer>
  );
}
