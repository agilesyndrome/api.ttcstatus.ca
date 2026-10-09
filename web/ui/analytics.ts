/** Privacy-preserving product analytics: reports only a broad, allowlisted
 * action name. No location, no identifiers beyond the server-issued anonymous
 * visitor cookie — the point is "how many distinct users today took <action>",
 * never who or where. */
const reported = new Set<string>();

export type TrackedAction =
  | 'located'
  | 'tracked-streetcar'
  | 'played-snake'
  | 'saved-stop'
  | 'removed-stop'
  | 'exported-map';

export function trackEvent(action: TrackedAction) {
  // One report per action per page load is enough for daily distinct counts.
  if (reported.has(action)) return;
  reported.add(action);
  try {
    void fetch('/api/v1/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never break the app.
  }
}
