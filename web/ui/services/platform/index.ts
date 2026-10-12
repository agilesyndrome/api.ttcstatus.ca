import { Capacitor } from '@capacitor/core';
import { createBrowserServices } from './browser';
import type { PlatformServices } from './contracts';

let services = createBrowserServices();
export const platform = (): PlatformServices => services;

/** Bootstrap before mounting React; browser bundles load no native plugin implementation. */
export async function initializePlatform() {
  if (Capacitor.isNativePlatform()) {
    const { createCapacitorServices } = await import('./capacitor');
    services = await createCapacitorServices();
  }
}
