import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useAccount } from './context';

export function AccountRequired({
  children,
  heading,
  helper,
}: {
  children?: ReactNode;
  /** Copy overrides for non-journal gates (the /sla sign-in). A custom
   * heading brings its own framing, so the journal eyebrow stays home. */
  heading?: string;
  helper?: string;
}) {
  useLanguage();
  const account = useAccount();
  if (account.loaded && account.userId) return <>{children}</>;
  return (
    <section className="account-required">
      {heading === undefined && (
        <p className="eyebrow">{t('account.yourPersonalCollection')}</p>
      )}
      <h1>{heading ?? t('account.makeItYourJournal')}</h1>
      <p className="helper">
        {helper ?? t('account.signInToCollectStreetcarsKeepRideNotesAndEarn')}
      </p>
      {!account.loaded ? (
        <p role="status">{t('account.loadingAccount')}</p>
      ) : account.enabled ? (
        <div className="comparison-actions">
          <button className="action-button" onClick={account.signIn}>
            {t('account.signIn')}
          </button>
          <button className="action-button" onClick={account.signUp}>
            {t('account.createAnAccount')}
          </button>
        </div>
      ) : (
        <p role="status">
          {t(account.error)} {t('account.youCanKeepExploringTheMap')}
        </p>
      )}
    </section>
  );
}
