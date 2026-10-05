import { english } from '../../../../shared/i18n/messages';
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../accounts/auth';
import { validJournal, type JournalEntry } from '../../../../shared/accounts/journal';

export function useAccountJournal() {
  const account = useAccount();
  const request = useRef(account.request);
  request.current = account.request;
  const identity = useRef(account.userId);
  identity.current = account.userId;
  const generation = useRef(0);
  const busy = useRef(false);
  const [state, setState] = useState<{
    userId: string | null;
    entries: JournalEntry[];
    revision: number;
    loaded: boolean;
    saving: boolean;
    error: string;
  }>({ userId: null, entries: [], revision: 0, loaded: false, saving: false, error: '' });
  useEffect(() => {
    generation.current++;
    const userId = account.userId;
    let cancelled = false;
    busy.current = false;
    setState({
      userId,
      entries: [],
      revision: 0,
      loaded: false,
      saving: false,
      error: '',
    });
    if (userId)
      void request
        .current('/api/v1/me/journal')
        .then(async (response) => {
          if (!response.ok) throw new Error('journal.unavailable');
          const value = (await response.json()) as { entries: unknown; revision: number };
          if (!validJournal(value.entries) || !Number.isSafeInteger(value.revision))
            throw new Error('journal.unavailable');
          if (!cancelled)
            setState({
              userId,
              entries: value.entries,
              revision: value.revision,
              loaded: true,
              saving: false,
              error: '',
            });
        })
        .catch((error) => {
          if (!cancelled) setState((current) => ({ ...current, error: error.message }));
        });
    return () => {
      cancelled = true;
    };
  }, [account.userId]);
  const current =
    state.userId === account.userId ? state : { ...state, entries: [], loaded: false };
  async function change(update: (entries: JournalEntry[]) => JournalEntry[]) {
    if (!account.userId || !current.loaded || busy.current) return false;
    const entries = update(current.entries);
    if (!validJournal(entries)) return false;
    const userId = account.userId;
    busy.current = true;
    const saveGeneration = generation.current;
    const isCurrent = () =>
      identity.current === userId && generation.current === saveGeneration;
    setState({ ...current, entries, saving: true, error: '' });
    return request
      .current('/api/v1/me/journal', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries, revision: current.revision }),
      })
      .then(async (response) => {
        if (response.status === 409)
          throw new Error(
            english('journal.yourJournalChangedInAnotherTabReloadItBeforeEditing'),
          );
        if (!response.ok)
          throw new Error(english('journal.yourChangeCouldNotBeSavedPleaseTryAgain'));
        const result = (await response.json()) as { revision: number };
        if (isCurrent())
          setState((previous) => ({
            ...previous,
            revision: result.revision,
            saving: false,
          }));
        return isCurrent();
      })
      .catch((error) => {
        if (isCurrent()) setState({ ...current, saving: false, error: error.message });
        return false;
      })
      .finally(() => {
        if (isCurrent()) busy.current = false;
      });
  }
  return {
    userId: account.userId,
    entries: current.entries,
    change,
    ready: current.loaded && !current.saving && !busy.current,
    saving: current.saving,
    error: current.error,
  };
}
