import type { PlatformServices } from '../contracts';
import { browserPreferences } from './preferences';
import { browserCache } from './cache';
import { browserLocation } from './location';
import { browserLifecycle } from './lifecycle';
import { browserSharing } from './sharing';

export function createBrowserServices(): PlatformServices {
  return {
    native: false,
    preferences: browserPreferences,
    cache: browserCache,
    location: browserLocation,
    lifecycle: browserLifecycle,
    sharing: browserSharing,
    // Safari has no reliable local scheduling service. Never pretend a JS timer is one.
    notifications: {
      available: false,
      async requestPermission() {
        return false;
      },
      async schedule() {
        throw new Error('Local reminders require the installed app');
      },
      async cancel() {},
    },
  };
}
