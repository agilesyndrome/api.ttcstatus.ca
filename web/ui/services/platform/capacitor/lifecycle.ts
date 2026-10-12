import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import type { Activity, PlatformServices } from '../contracts';

export async function createNativeLifecycle(
  appPlugin = App,
  networkPlugin = Network,
): Promise<PlatformServices['lifecycle']> {
  const [app, network] = await Promise.all([
    appPlugin.getState(),
    networkPlugin.getStatus(),
  ]);
  let state: Activity = { active: app.isActive, online: network.connected };
  const listeners = new Set<(next: Activity) => void>();
  const links = new Set<(url: string) => void>();
  const pending: string[] = [];
  const update = (next: Partial<Activity>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };
  // One application-wide listener per plugin; screens only subscribe to this service.
  await appPlugin.addListener('appStateChange', ({ isActive }) =>
    update({ active: isActive }),
  );
  await networkPlugin.addListener('networkStatusChange', ({ connected }) =>
    update({ online: connected }),
  );
  const open = (url: string) => {
    if (!links.size) pending.push(url);
    else links.forEach((listener) => listener(url));
  };
  await appPlugin.addListener('appUrlOpen', ({ url }) => open(url));
  const launch = await appPlugin.getLaunchUrl();
  if (launch?.url) open(launch.url);
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeLinks(listener) {
      links.add(listener);
      pending.splice(0).forEach(listener);
      return () => {
        links.delete(listener);
      };
    },
  };
}
