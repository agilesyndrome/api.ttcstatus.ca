/** Local-only opt-in for the delivered-service overlay when auth is unavailable.
 * `?voidOverlay=1` persists in sessionStorage across local refreshes; production
 * must never treat an auth outage as permission to enable this bypass. */
export const DEV_BYPASS_KEY = 'ttc:voidOverlay-dev';

export function readDevOverlayBypass(): boolean {
  try {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('voidOverlay') === '1') {
      sessionStorage.setItem(DEV_BYPASS_KEY, '1');
      return true;
    }
    return sessionStorage.getItem(DEV_BYPASS_KEY) === '1';
  } catch {
    return false;
  }
}
