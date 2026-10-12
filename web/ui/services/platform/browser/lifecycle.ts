import type { PlatformServices } from '../contracts';

const current = () => ({ active: !document.hidden, online: navigator.onLine });
export const browserLifecycle: PlatformServices['lifecycle'] = {
  current,
  subscribe(listener) {
    const update = () => listener(current());
    const away = () => listener({ ...current(), active: false });
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('pageshow', update);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('pageshow', update);
      window.removeEventListener('pagehide', away);
    };
  },
  // Browser URLs are handled by navigation; device launch URLs enter through this port.
  subscribeLinks: () => () => {},
};
