import { LocationError, type PlatformServices } from '../contracts';

export const browserLocation: PlatformServices['location'] = {
  current() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new LocationError('unavailable'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) =>
          resolve({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          }),
        (error) =>
          reject(
            new LocationError(
              error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'failed',
            ),
          ),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
      );
    });
  },
};
