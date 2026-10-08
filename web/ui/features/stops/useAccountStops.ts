import { english } from '../../../../shared/i18n/messages';
import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../accounts/auth';
import { validSavedStops } from '../../../../shared/accounts/saved-stops';

/** Saved stops persist in the account database, like journals, not the browser. */
export function useAccountStops() {
  const account = useAccount();
  const request = useRef(account.request);
  request.current = account.request;
  const identity = useRef(account.userId);
  identity.current = account.userId;
  const generation = useRef(0);
  const busy = useRef(false);
  const [state, setState] = useState<{
    userId: string | null;
    stopIds: string[];
    revision: number;
    loaded: boolean;
    saving: boolean;
    error: string;
  }>({ userId: null, stopIds: [], revision: 0, loaded: false, saving: false, error: '' });
  useEffect(() => {
    generation.current++;
    const userId = account.userId;
    let cancelled = false;
    busy.current = false;
    setState({
      userId,
      stopIds: [],
      revision: 0,
      loaded: false,
      saving: false,
      error: '',
    });
    if (userId)
      void request
        .current('/api/v1/me/stops')
        .then(async (response) => {
          if (!response.ok) throw new Error('saved-stops.unavailable');
          const value = (await response.json()) as {
            stopIds: unknown;
            revision: number;
          };
          if (!validSavedStops(value.stopIds) || !Number.isSafeInteger(value.revision))
            throw new Error('saved-stops.unavailable');
          if (!cancelled)
            setState({
              userId,
              stopIds: value.stopIds,
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
    state.userId === account.userId ? state : { ...state, stopIds: [], loaded: false };
  async function change(update: (stopIds: string[]) => string[]) {
    if (!account.userId || !current.loaded || busy.current) return false;
    const stopIds = update(current.stopIds);
    if (!validSavedStops(stopIds)) return false;
    const userId = account.userId;
    busy.current = true;
    const saveGeneration = generation.current;
    const isCurrent = () =>
      identity.current === userId && generation.current === saveGeneration;
    setState({ ...current, stopIds, saving: true, error: '' });
    return request
      .current('/api/v1/me/stops', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stopIds, revision: current.revision }),
      })
      .then(async (response) => {
        if (response.status === 409)
          throw new Error(
            english('savedStops.yourSavedStopsChangedInAnotherTabReloadThem'),
          );
        if (!response.ok)
          throw new Error(english('savedStops.yourChangeCouldNotBeSavedPleaseTry'));
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
        if (isCurrent())
          setState((current) => ({ ...current, saving: false, error: error.message }));
        return false;
      })
      .finally(() => {
        if (isCurrent()) busy.current = false;
      });
  }
  return {
    userId: account.userId,
    stopIds: current.stopIds,
    change,
    ready: current.loaded && !current.saving && !busy.current,
    saving: current.saving,
    error: current.error,
  };
}
