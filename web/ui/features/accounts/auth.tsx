import { english } from '../../../../shared/i18n/messages';
import { accountLocales } from '../../i18n/clerk';
import { t, getLocale, setLanguagePreference, isLanguagePreference } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, UserButton, useAuth, useClerk, useUser } from '@clerk/react';

interface Account {
  enabled: boolean;
  loaded: boolean;
  userId: string | null;
  error: string;
  retry(): void;
  signIn(): void;
  signUp(): void;
  request(path: string, init?: RequestInit): Promise<Response>;
  saveLanguage(language: string): Promise<void>;
}
const unavailable = async (): Promise<Response> => {
  throw new Error(english('account.signInToContinue'));
};
const defaults: Account = {
  enabled: false,
  loaded: true,
  userId: null,
  error: '',
  retry() {},
  signIn() {},
  signUp() {},
  request: unavailable,
  saveLanguage: async () => {},
};
const AccountContext = createContext<Account>(defaults);
export const useAccount = () => useContext(AccountContext);

function ClerkAccount({ children }: { children: ReactNode }) {
  useLanguage();
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  useEffect(() => {
    const language = user?.unsafeMetadata?.language;
    if (typeof language === 'string' && isLanguagePreference(language))
      setLanguagePreference(language);
  }, [user]);
  return (
    <AccountContext.Provider
      value={{
        enabled: true,
        loaded: isLoaded,
        userId: userId ?? null,
        error: '',
        retry() {},
        signIn: () => {
          void clerk.openSignIn();
        },
        signUp: () => {
          void clerk.openSignUp();
        },
        request: async (path, init) => {
          const token = await getToken();
          if (!token) throw new Error(english('account.yourSessionHasEndedSignInAgain'));
          const headers = new Headers(init?.headers);
          headers.set('authorization', `Bearer ${token}`);
          return fetch(path, {
            ...init,
            headers,
            cache: 'no-store',
            credentials: 'omit',
          });
        },
        saveLanguage: async (language) => {
          if (user)
            await user.update({
              unsafeMetadata: { ...user.unsafeMetadata, language },
            });
        },
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

/** The public map renders while auth configuration and Clerk load. */
export function AccountProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const [config, setConfig] = useState<{ enabled: boolean; publishableKey?: string }>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setConfig(undefined);
    setError('');
    setAttempt((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/auth/config', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value) => {
        if (
          !value ||
          typeof value.enabled !== 'boolean' ||
          (value.enabled &&
            (typeof value.publishableKey !== 'string' ||
              !value.publishableKey.startsWith('pk_')))
        )
          throw new Error();
        if (!controller.signal.aborted) {
          setConfig(value);
          setError(
            value.enabled
              ? ''
              : english('account.accountsAreTemporarilyUnavailableTryAgainInAMoment'),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setConfig({ enabled: false });
          setError(english('account.unableToLoadAccountsPleaseTryAgain'));
        }
      });
    return () => controller.abort();
  }, [attempt]);
  if (!config?.enabled || !config.publishableKey)
    return (
      <AccountContext.Provider
        value={{ ...defaults, loaded: Boolean(config), error, retry }}
      >
        {children}
      </AccountContext.Provider>
    );
  return (
    <ClerkProvider
      localization={accountLocales[getLocale()]}
      publishableKey={config.publishableKey}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <ClerkAccount>{children}</ClerkAccount>
    </ClerkProvider>
  );
}

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
          <a className="theme-toggle profile-toggle" href="/profile">
            {t('account.profile')}
          </a>
          <UserButton />
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
