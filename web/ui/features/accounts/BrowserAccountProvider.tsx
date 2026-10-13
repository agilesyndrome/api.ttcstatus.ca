import { useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';
import { apiRequest, createApiClient } from '../../services/http/client';
import { getLocale, setLanguagePreference, isLanguagePreference } from '../../i18n';
import { accountLocales } from '../../i18n/clerk';
import { useLanguage } from '../../i18n/react';
import { AccountContext, defaultAccount } from './context';
import { TrackWork } from '../../components/page/TrackWork';

type AuthConfigState =
  | { status: 'loading' }
  | { status: 'ready'; publishableKey: string }
  | { status: 'maintenance' }
  | { status: 'unavailable' };

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
        request: createApiClient({ token: getToken, credentials: 'omit' }),
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

/** Public pages load while account configuration is checked. Only an explicit
 * disabled config puts the site in maintenance mode. */
export function BrowserAccountProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const [config, setConfig] = useState<AuthConfigState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setConfig({ status: 'loading' });
    setAttempt((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/v1/auth/config', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value) => {
        if (!value || typeof value.enabled !== 'boolean') throw new Error();
        if (!value.enabled) {
          if (!controller.signal.aborted) setConfig({ status: 'maintenance' });
          return;
        }
        if (
          typeof value.publishableKey !== 'string' ||
          !value.publishableKey.startsWith('pk_')
        )
          throw new Error();
        if (!controller.signal.aborted)
          setConfig({ status: 'ready', publishableKey: value.publishableKey });
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfig({ status: 'unavailable' });
      });
    return () => controller.abort();
  }, [attempt]);
  if (config.status === 'maintenance') return <TrackWork onRetry={retry} />;
  if (config.status !== 'ready')
    return (
      <AccountContext.Provider
        value={{
          ...defaultAccount,
          loaded: config.status === 'unavailable',
          error:
            config.status === 'unavailable'
              ? 'account.accountsAreTemporarilyUnavailableTryAgainInAMoment'
              : '',
          retry,
        }}
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
