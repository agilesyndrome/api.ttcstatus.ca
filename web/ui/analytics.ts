import { apiRequest } from './services/http/client';
/** Privacy-preserving product analytics: reports only a broad, allowlisted
 * action name. No location, no identifiers beyond the server-issued anonymous
 * visitor cookie — the point is "how many distinct users today took <action>",
 * never who or where. */
const reported = new Set<string>();

const TRACKED_ACTIONS = [
  'located',
  'tracked-streetcar',
  'played-snake',
  'saved-stop',
  'removed-stop',
  'exported-map',
  'saved-default-view',
  'reset-default-view',
] as const;

export type TrackedAction = (typeof TRACKED_ACTIONS)[number];

/** Runtime mirror of TrackedAction. tests/api/analytics.test.mjs pins this
 * list to the server's accepted action set so the two allowlists cannot
 * drift apart (a client action the server rejects is a silently lost event). */
export const trackedActions: readonly TrackedAction[] = TRACKED_ACTIONS;

export function trackEvent(action: TrackedAction) {
  // One report per action per page load is enough for daily distinct counts.
  if (reported.has(action)) return;
  reported.add(action);
  try {
    void apiRequest('/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never break the app.
  }
}
