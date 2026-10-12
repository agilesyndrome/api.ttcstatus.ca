import type { PlatformServices } from '../contracts';
import { nativePreferences } from './preferences';
import { nativeCache } from './cache';
import { nativeLocation } from './location';
import { nativeSharing } from './sharing';
import { createNativeLifecycle } from './lifecycle';
import { createNativeNotifications } from './notifications';

export async function createCapacitorServices(): Promise<PlatformServices> {
  const lifecycle = await createNativeLifecycle();
  const listeners = new Set<(url: string) => void>();
  const pending: string[] = [];
  const open = (url: string) => {
    if (!listeners.size) pending.push(url);
    else listeners.forEach((listener) => listener(url));
  };
  lifecycle.subscribeLinks(open);
  const notifications = await createNativeNotifications(open);
  return {
    native: true,
    preferences: nativePreferences,
    cache: nativeCache,
    location: nativeLocation,
    sharing: nativeSharing,
    notifications,
    lifecycle: {
      ...lifecycle,
      subscribeLinks(listener) {
        listeners.add(listener);
        pending.splice(0).forEach(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}
