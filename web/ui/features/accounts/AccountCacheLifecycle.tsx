import { useEffect, useRef, type ReactNode } from 'react';
import { useAccount } from './context';
import { forgetAccountDocuments } from './document-cache';

/** Cache ownership follows either the browser SDK or an injected native session driver. */
export function AccountCacheLifecycle({ children }: { children: ReactNode }) {
  const account = useAccount();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!account.loaded) return;
    if (previous.current && previous.current !== account.userId)
      void forgetAccountDocuments(previous.current);
    previous.current = account.userId;
  }, [account.loaded, account.userId]);
  return children;
}
