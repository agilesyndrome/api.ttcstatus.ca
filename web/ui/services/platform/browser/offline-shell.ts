/** Installed native bundles already contain the shell; browsers cache the public build. */
export function registerOfflineShell() {
  if (!import.meta.env?.PROD || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
