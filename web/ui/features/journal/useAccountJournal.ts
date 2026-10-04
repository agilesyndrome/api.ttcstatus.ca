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
  const [retry, setRetry] = useState(0);
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
          if (!response.ok) throw new Error('Unable to load your journal. Try again.');
          const value = (await response.json()) as { entries: unknown; revision: number };
          if (!validJournal(value.entries) || !Number.isSafeInteger(value.revision))
            throw new Error('Unable to read your journal.');
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
  }, [account.userId, retry]);
  const current =
    state.userId === account.userId ? state : { ...state, entries: [], loaded: false };
  function change(update: (entries: JournalEntry[]) => JournalEntry[]) {
    if (!account.userId || !current.loaded || busy.current) return;
    const entries = update(current.entries);
    if (!validJournal(entries)) return;
    const userId = account.userId;
    busy.current = true;
    const saveGeneration = generation.current;
    const isCurrent = () =>
      identity.current === userId && generation.current === saveGeneration;
    setState({ ...current, entries, saving: true, error: '' });
    void request
      .current('/api/v1/me/journal', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries, revision: current.revision }),
      })
      .then(async (response) => {
        if (response.status === 409)
          throw new Error(
            'Your journal changed in another tab. Reload it before editing again.',
          );
        if (!response.ok)
          throw new Error('Your change could not be saved. Please try again.');
        const result = (await response.json()) as { revision: number };
        if (isCurrent())
          setState((previous) => ({
            ...previous,
            revision: result.revision,
            saving: false,
          }));
      })
      .catch((error) => {
        if (isCurrent()) setState({ ...current, saving: false, error: error.message });
      })
      .finally(() => {
        if (isCurrent()) busy.current = false;
      });
  }
  return {
    entries: current.entries,
    change,
    ready: current.loaded && !current.saving && !busy.current,
    saving: current.saving,
    error: current.error,
    reload: () => setRetry((value) => value + 1),
  };
}
