import { type SetStateAction, useEffect, useRef } from 'react';
import { usePreference } from '../../../hooks/usePreferences';
import { validSavedStops } from '../../../../../shared/accounts/saved-stops';
import { useAccount } from '../../accounts/auth';
import { useAccountStops } from '../../stops/useAccountStops';

export function useSavedStops() {
  // Signed-out visitors keep stops in this browser; signing in moves them to
  // the account database, where the server owns durability and conflict checks.
  const [localStops, setLocalStops, savedPersistent] = usePreference<string[]>(
    'ttc:stops:v1',
    [],
    validSavedStops,
  );
  const account = useAccount();
  const accountStops = useAccountStops();
  const signedIn = Boolean(account.userId);
  const savedStops = signedIn ? accountStops.stopIds : localStops;
  function setSavedStops(update: SetStateAction<string[]>) {
    if (signedIn)
      void accountStops.change((current) =>
        typeof update === 'function' ? update(current) : update,
      );
    else setLocalStops(update);
  }
  const migratedStops = useRef<string | null>(null);
  useEffect(() => {
    const userId = account.userId;
    if (!userId) {
      migratedStops.current = null;
      return;
    }
    if (!accountStops.ready || migratedStops.current === userId) return;
    if (!localStops.length) {
      migratedStops.current = userId;
      return;
    }
    migratedStops.current = userId;
    void accountStops
      .change((current) => [...new Set([...current, ...localStops])].slice(0, 100))
      .then((saved) => {
        if (saved) setLocalStops([]);
        // Keep a failed import in local storage and retry on the next sign-in.
        // Resetting here would retry on every render after a network/conflict error.
      });
  }, [account.userId, accountStops.ready, accountStops.change, localStops]);
  return {
    savedStops,
    setSavedStops,
    savedPersistent,
    savedSignedIn: signedIn,
    savedCached: accountStops.cached,
    savedAccount: accountStops,
  };
}
