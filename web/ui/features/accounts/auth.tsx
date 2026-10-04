import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, UserButton, useAuth, useClerk } from '@clerk/react';

interface Account {
  enabled: boolean;
  loaded: boolean;
  userId: string | null;
  error: string;
  retry(): void;
  signIn(): void;
  signUp(): void;
  request(path: string, init?: RequestInit): Promise<Response>;
}
const unavailable = async (): Promise<Response> => {
  throw new Error('Sign in to continue.');
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
};
const AccountContext = createContext<Account>(defaults);
export const useAccount = () => useContext(AccountContext);

function ClerkAccount({ children }: { children: ReactNode }) {
  const { isLoaded, userId, getToken } = useAuth();
  const clerk = useClerk();
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
          if (!token) throw new Error('Your session has ended. Sign in again.');
          const headers = new Headers(init?.headers);
          headers.set('authorization', `Bearer ${token}`);
          return fetch(path, {
            ...init,
            headers,
            cache: 'no-store',
            credentials: 'omit',
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
              : 'Accounts are temporarily unavailable. Try again in a moment.',
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setConfig({ enabled: false });
          setError('Unable to load accounts. Please try again.');
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
      publishableKey={config.publishableKey}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <ClerkAccount>{children}</ClerkAccount>
    </ClerkProvider>
  );
}

export function AuthControls() {
  const account = useAccount();
  if (!account.loaded) return <span className="auth-status">Loading account…</span>;
  if (!account.enabled)
    return (
      <div className="auth-controls">
        <span className="auth-status" role="status">
          Accounts unavailable
        </span>
        <button className="action-button" onClick={account.retry}>
          Retry accounts
        </button>
      </div>
    );
  return (
    <nav className="auth-controls" aria-label="Your account">
      {account.userId ? (
        <>
          <a className="account-link" href="/profile">
            Profile
          </a>
          <UserButton />
        </>
      ) : (
        <>
          <button className="action-button" onClick={account.signIn}>
            Sign in
          </button>
          <button className="action-button signup-button" onClick={account.signUp}>
            Sign up
          </button>
        </>
      )}
    </nav>
  );
}

export function AccountRequired({ children }: { children: ReactNode }) {
  const account = useAccount();
  if (account.loaded && account.userId) return children;
  return (
    <section className="account-required">
      <p className="eyebrow">Your personal collection</p>
      <h1>Make it your journal.</h1>
      <p className="helper">
        Sign in to collect streetcars, keep ride notes and earn badges. The TTC status map
        is always open to everyone.
      </p>
      {!account.loaded ? (
        <p role="status">Loading account…</p>
      ) : account.enabled ? (
        <div className="comparison-actions">
          <button className="action-button" onClick={account.signIn}>
            Sign in
          </button>
          <button className="action-button" onClick={account.signUp}>
            Create an account
          </button>
        </div>
      ) : (
        <p role="status">{account.error} You can keep exploring the map.</p>
      )}
    </section>
  );
}
