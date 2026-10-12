import type { ReactNode } from 'react';
import { AccountContext, type Account } from './context';
import { BrowserAccountProvider } from './BrowserAccountProvider';
import { AccountCacheLifecycle } from './AccountCacheLifecycle';

/** The native shell may supply its own session driver; feature hooks use the same account port. */
export function AccountProvider({
  children,
  adapter,
}: {
  children: ReactNode;
  adapter?: Account;
}) {
  const content = <AccountCacheLifecycle>{children}</AccountCacheLifecycle>;
  return adapter ? (
    <AccountContext.Provider value={adapter}>{content}</AccountContext.Provider>
  ) : (
    <BrowserAccountProvider>{content}</BrowserAccountProvider>
  );
}
