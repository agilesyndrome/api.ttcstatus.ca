import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useAccount } from '../features/accounts/auth';
import { usePreference } from './usePreferences';
import type { ColourMode } from '../../../shared/map/field-palette';
import { trackEvent } from '../analytics';

type AccountRequest = (path: string, init?: RequestInit) => Promise<Response>;

const STORAGE_KEY = 'ttc:colour:v1';
const validColourMode = (value: unknown): value is ColourMode =>
  value === 'standard' || value === 'redgreen' || value === 'full';

interface ColourModeContextValue {
  colourMode: ColourMode;
  setColourMode: (mode: ColourMode) => void;
}

const ColourModeContext = createContext<ColourModeContextValue | null>(null);

/**
 * Local-first colour preference with profile synchronisation. A default DB
 * value cannot erase a deliberate signed-out choice on first sign-in; after
 * hydration, changes are ordinary last-write-wins profile updates.
 */
export function ColourModeProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const [colourMode, setColourMode] = usePreference<ColourMode>(
    STORAGE_KEY,
    'standard',
    validColourMode,
  );
  const localMode = useRef(colourMode);
  localMode.current = colourMode;
  const syncedUser = useRef<string | null>(null);
  const profile = useRef<{ username: string; publicBadges: boolean } | null>(null);

  useEffect(() => {
    if (!account.userId || !account.loaded || syncedUser.current === account.userId)
      return;
    syncedUser.current = account.userId;
    let cancelled = false;
    void account
      .request('/api/v1/me/profile')
      .then((response) => {
        if (!response.ok) throw new Error('profile unavailable');
        return response.json() as Promise<{
          username: string;
          publicBadges: boolean;
          colorMode: ColourMode;
        }>;
      })
      .then(async (remote) => {
        if (cancelled) return;
        profile.current = {
          username: remote.username,
          publicBadges: remote.publicBadges,
        };
        if (remote.colorMode === 'standard' && localMode.current !== 'standard') {
          await saveProfile(account.request, profile.current, localMode.current);
        } else if (remote.colorMode !== 'standard') {
          setColourMode(remote.colorMode);
        }
      })
      .catch(() => {
        // A preference outage must not prevent the map from loading.
      });
    return () => {
      cancelled = true;
    };
  }, [account, setColourMode]);

  const change = (mode: ColourMode) => {
    setColourMode(mode);
    trackEvent('colour-mode-change');
    if (!account.userId || !profile.current) return;
    void saveProfile(account.request, profile.current, mode);
  };
  return (
    <ColourModeContext.Provider value={{ colourMode, setColourMode: change }}>
      {children}
    </ColourModeContext.Provider>
  );
}

async function saveProfile(
  request: AccountRequest,
  profile: { username: string; publicBadges: boolean },
  colourMode: ColourMode,
): Promise<void> {
  await request('/api/v1/me/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...profile, colorMode: colourMode }),
  });
}

export function useColourMode(): ColourModeContextValue {
  const value = useContext(ColourModeContext);
  // Isolated Storybook stories intentionally render small service components
  // without the application shell; they still get the safe default palette.
  return value ?? { colourMode: 'standard', setColourMode: () => {} };
}
