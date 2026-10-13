/** Local-dev only: an explicit opt-in for the delivered-service overlay when
 * the site itself runs without auth. The
 * opt-in is `?voidOverlay=1` in the URL, persisted in sessionStorage so a
 * refresh keeps the overlay while you work. This exists because local dev
 * cannot authenticate — the per-user gate is otherwise undemoable at home. */
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
