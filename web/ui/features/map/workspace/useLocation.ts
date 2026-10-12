import { useEffect, useMemo, useRef, useState } from 'react';
import { english } from '../../../../../shared/i18n/messages';
import {
  boundsOf,
  type Bounds,
  type Point,
  type ViewerData,
} from '../../../../../shared/map/model';
import { gpsToMap } from '../../../../../shared/map/projection';
import { nearbyStops, type Location } from '../../../commute';
import { trackEvent } from '../../../analytics';
import { platform } from '../../../services/platform';
import { LocationError } from '../../../services/platform/contracts';
import type { Dispatch, SetStateAction } from 'react';

interface Options {
  data?: ViewerData;
  setFollowing: Dispatch<SetStateAction<boolean>>;
  setFocusPoint: Dispatch<SetStateAction<Point | undefined>>;
  setFocusPointLevel: Dispatch<SetStateAction<number | undefined>>;
  setFocusBounds: Dispatch<SetStateAction<Bounds | undefined>>;
  setResetKey: Dispatch<SetStateAction<number>>;
}
export function useLocation({
  data,
  setFollowing,
  setFocusPoint,
  setFocusPointLevel,
  setFocusBounds,
  setResetKey,
}: Options) {
  const [location, setLocation] = useState<Location>();
  const locationPoint = useMemo(
    () =>
      data && location
        ? gpsToMap(location.latitude, location.longitude, data.geographicTransform)
        : undefined,
    [data, location],
  );
  function locate(next: Location) {
    if (!data) return;
    setLocation(next);
    setFollowing(false);
    // Frame the location together with its two nearest stations so the zoom
    // answers "which stations are closest to me" instead of showing the whole
    // neighborhood. Out-of-area locations keep the full Toronto map in view
    // instead of panning to empty space.
    const here = gpsToMap(next.latitude, next.longitude, data.geographicTransform);
    const stations = nearbyStops(data, next)
      .slice(0, 2)
      .map((stop) => stop.feature.point);
    setFocusPoint(undefined);
    setFocusPointLevel(undefined);
    if (stations.length) {
      // Frame exactly this position and the two nearest stations. Padding
      // grows with the span (15%, at least 10 map units ≈ 140 m) instead of
      // a fixed inset, so the zoom answers "which stations are closest to
      // me" at any station density without pulling in the wider network.
      const box = boundsOf([here, ...stations], 0);
      const pad = Math.max(10, 0.15 * Math.max(box.width, box.height));
      setFocusBounds({
        x: box.x - pad,
        y: box.y - pad,
        width: box.width + 2 * pad,
        height: box.height + 2 * pad,
      });
    } else {
      setFocusBounds(undefined);
      setResetKey((key) => key + 1);
    }
  }
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const locateRequest = useRef(0);
  useEffect(
    () => () => {
      locateRequest.current++;
    },
    [],
  );
  // One map-level control owns geolocation, so the explore panel stays
  // read-only and errors surface on the map beside the button that caused them.
  function requestLocate() {
    if (!data) return;
    const current = ++locateRequest.current;
    setLocating(true);
    setLocateError('');
    void platform()
      .location.current()
      .then((position) => {
        if (current !== locateRequest.current) return;
        setLocating(false);
        trackEvent('located');
        locate(position);
      })
      .catch((error) => {
        if (current !== locateRequest.current) return;
        setLocating(false);
        const reason = error instanceof LocationError ? error.reason : 'failed';
        setLocateError(
          english(
            reason === 'denied'
              ? 'nearbyStops.locationPermissionWasDeclinedYouCanStillSearchForA'
              : reason === 'timeout'
                ? 'nearbyStops.locationTookTooLongTryAgainOrSearchForA'
                : reason === 'unavailable'
                  ? 'nearbyStops.locationIsUnavailableInThisBrowserYouCanSearchFor'
                  : 'nearbyStops.yourLocationCouldNotBeFoundTryAgainOrSearch',
          ),
        );
      });
  }
  return {
    location,
    setLocation,
    locationPoint,
    locating,
    locateError,
    requestLocate,
    clearLocateError: () => setLocateError(''),
  };
}
