import { Geolocation } from '@capacitor/geolocation';
import { LocationError, type PlatformServices } from '../contracts';

export function createNativeLocation(plugin = Geolocation): PlatformServices['location'] {
  return {
    async current() {
      try {
        const position = await plugin.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 0,
        });
        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        throw new LocationError(
          code === 'OS-PLUG-GLOC-0003'
            ? 'denied'
            : code === 'OS-PLUG-GLOC-0010'
              ? 'timeout'
              : code === 'OS-PLUG-GLOC-0007'
                ? 'unavailable'
                : 'failed',
        );
      }
    },
  };
}
export const nativeLocation = createNativeLocation();
