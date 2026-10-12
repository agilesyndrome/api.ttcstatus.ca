import { useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';
import { apiRequest, createApiClient } from '../../services/http/client';
import { getLocale, setLanguagePreference, isLanguagePreference } from '../../i18n';
import { accountLocales } from '../../i18n/clerk';
import { useLanguage } from '../../i18n/react';
import { AccountContext } from './context';
import { TrackWork } from '../../components/page/TrackWork';

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

/** The app remains in maintenance mode until auth configuration is usable. */
export function BrowserAccountProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const [config, setConfig] = useState<{
    enabled: boolean;
    publishableKey?: string | null;
  }>();
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setConfig(undefined);
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
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setConfig({ enabled: false });
        }
      });
    return () => controller.abort();
  }, [attempt]);
  if (!config?.enabled || !config.publishableKey) return <TrackWork onRetry={retry} />;
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
