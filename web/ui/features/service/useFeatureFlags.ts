import { useEffect, useState } from 'react';
import type { FeatureFlagsResponse } from '../../../../shared/service/contracts';
import { VOID_OVERLAY_FLAG } from '../../../../shared/service/contracts';
import { useAccount } from '../accounts/auth';

export interface FeatureFlags {
  /** False while the account state or the flags request is still in flight. */
  loaded: boolean;
  /** True only for a signed-in caller (signed-out callers see nothing). */
  available: boolean;
  has(flag: string): boolean;
  /** Convenience for the debug overlay's gate (sla.md §4.7). */
  overlayEnabled: boolean;
}

/** Fetch the caller's per-user feature flags once per session
 * (sla-epics.md §0B). Nothing consumes this yet — that is the point: the gate
 * exists before the overlay does. Signed-out users and everyone else see
 * nothing. */
export function useFeatureFlags(): FeatureFlags {
  const account = useAccount();
  const [flags, setFlags] = useState<string[] | null>(null);
  const userId = account.loaded ? account.userId : null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void flagsFor(userId, account.request).then((value) => {
      if (!cancelled) setFlags(value);
    });
    return () => {
      cancelled = true;
    };
    // account.request is stable per session (Clerk token refresh re-reads
    // inside the request helper); the session cache below prevents refetches.
  }, [userId]);
  return {
    loaded: !userId || flags !== null,
    available: Boolean(userId),
    has: (flag: string) => flags?.includes(flag) ?? false,
    overlayEnabled: flags?.includes(VOID_OVERLAY_FLAG) ?? false,
  };
}

/** One flags fetch per user per session: remounts reuse the in-flight promise. */
const sessionFlags = new Map<string, Promise<string[]>>();

function flagsFor(
  userId: string,
  request: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<string[]> {
  let pending = sessionFlags.get(userId);
  if (!pending) {
    pending = request('/api/v1/me/features')
      .then((response) =>
        response.ok ? (response.json() as Promise<FeatureFlagsResponse>) : null,
      )
      .then((body) =>
        Array.isArray(body?.flags)
          ? body.flags.filter((flag) => typeof flag === 'string')
          : [],
      )
      .catch(() => []);
    sessionFlags.set(userId, pending);
  }
  return pending;
}
