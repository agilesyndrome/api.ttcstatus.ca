import { createContext, useContext } from 'react';
import { english } from '../../../../shared/i18n/messages';

export interface Account {
  enabled: boolean;
  loaded: boolean;
  userId: string | null;
  error: string;
  retry(): void;
  signIn(): void;
  signUp(): void;
  /** Native account drivers supply their own account management UI and sign-out. */
  manageAccount?(): void;
  signOut?(): void;
  request(path: string, init?: RequestInit): Promise<Response>;
  saveLanguage(language: string): Promise<void>;
}
const unavailable = async (): Promise<Response> => {
  throw new Error(english('account.signInToContinue'));
};
export const defaultAccount: Account = {
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
export const AccountContext = createContext<Account>(defaultAccount);
export const useAccount = () => useContext(AccountContext);
