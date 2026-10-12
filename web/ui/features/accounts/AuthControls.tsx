import { UserButton } from '@clerk/react';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useAccount } from './context';

export function AuthControls() {
  useLanguage();
  const account = useAccount();
  if (!account.loaded)
    return <span className="auth-status">{t('account.loadingAccount')}</span>;
  if (!account.enabled)
    return (
      <div className="auth-controls">
        <span className="auth-status" role="status">
          {t('account.accountsUnavailable')}
        </span>
        <button className="action-button" onClick={account.retry}>
          {t('account.retryAccounts')}
        </button>
      </div>
    );
  return (
    <nav className="auth-controls" aria-label={t('account.yourAccount')}>
      {account.userId ? (
        <>
          <a className="theme-toggle profile-toggle" href="/settings">
            {t('account.profile')}
          </a>
          {account.signOut ? (
            <button className="action-button" onClick={account.signOut}>
              {t('account.signOut')}
            </button>
          ) : (
            <UserButton />
          )}
        </>
      ) : (
        <>
          <button className="action-button" onClick={account.signIn}>
            {t('account.signIn')}
          </button>
          <button className="action-button signup-button" onClick={account.signUp}>
            {t('account.signUp')}
          </button>
        </>
      )}
    </nav>
  );
}
