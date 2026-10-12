import { clientConfig } from '../http/config';
import { platform } from '../platform';
import { internalDestination } from './destinations';

let lastMapRoute = '/';
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());
export const currentRoute = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;
export function subscribeRoute(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function navigate(input: string, replace = false) {
  let destination = internalDestination(
    input,
    window.location.origin,
    clientConfig().siteOrigin,
  );
  if (!destination) return;
  if (window.location.pathname === '/') lastMapRoute = currentRoute();
  else if (destination === '/') destination = lastMapRoute;
  if (destination === currentRoute()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', destination);
  publish();
}

/** Selection updates do not create dozens of Back entries or notify other screens. */
export function replaceMapHash(hash: string) {
  if (window.location.pathname !== '/' || window.location.hash === hash) return;
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}

export function startNavigation() {
  window.addEventListener('popstate', publish);
  window.addEventListener('hashchange', publish);
  const stopLinks = platform().lifecycle.subscribeLinks((url) => navigate(url));
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (
      !anchor ||
      anchor.hasAttribute('download') ||
      (anchor.target && anchor.target !== '_self')
    )
      return;
    const destination = internalDestination(
      anchor.href,
      window.location.origin,
      clientConfig().siteOrigin,
    );
    if (!destination) return;
    event.preventDefault();
    navigate(destination);
  };
  document.addEventListener('click', click);
  return () => {
    window.removeEventListener('popstate', publish);
    window.removeEventListener('hashchange', publish);
    document.removeEventListener('click', click);
    stopLinks();
  };
}
